import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import type { Socket } from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { generate } from 'selfsigned';
import type { RelayJoinRequest, RelayMessage, RelayOperationResult, RelayPeer, RelaySecurityAlert, RelaySharedMarker, RelayState, RelayTransfer } from '../shared/contracts';
import { PortablePathService } from './portable-path';
import { ProfileService, validateDisplayName } from './profile-service';

const PROTOCOL = 'outpost-relay/1';
const DEFAULT_DISCOVERY_PORT = 45454;
const DEFAULT_MULTICAST_ADDRESS = '239.255.42.99';
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024 * 1024;

interface StoredPeer {
  id: string; displayName: string; fingerprint: string; publicKey: string; address: string; port: number;
  lastSeenAt: string; verified: boolean; identityChanged: boolean;
  group?: RelayMembershipCredential;
}
interface RelayMembershipCredential {
  groupId: string; groupName: string; ownerId: string; ownerPublicKey: string; memberId: string; callsign: string;
  role: 'owner' | 'member'; joinedAt: string; signature: string;
}
interface StoredGroup {
  id: string; name: string; ownerId: string; ownerPublicKey: string; callsign: string; role: 'owner' | 'member'; joiningOpen: boolean;
  credential: RelayMembershipCredential; phraseSalt?: string; phraseVerifier?: string; duressSalt?: string; duressVerifier?: string;
  members: RelayMembershipCredential[];
}
interface StoredRelayState {
  version: 2; historyEnabled: boolean; peers: StoredPeer[]; messages: RelayMessage[];
  group: StoredGroup | null; joinRequests: RelayJoinRequest[]; securityAlerts: RelaySecurityAlert[]; sharedMarkers: RelaySharedMarker[];
}
type Frame = Record<string, unknown> & { type: string };
interface RelayOptions { discovery?: boolean; discoveryPort?: number; multicastAddress?: string; listenPort?: number; bindAddress?: string; }
interface PendingDecision { resolve: (decision: { accept: boolean; destination?: string; relativePath?: string }) => void; }

function atomicJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.new`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}
function publicKeyId(publicKey: string): string {
  const der = crypto.createPublicKey(publicKey).export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
}
function fingerprint(publicKey: string): string {
  const digest = publicKeyId(publicKey);
  return digest.match(/.{1,4}/g)?.slice(0, 8).join('-') ?? digest;
}
function safeName(value: string): string {
  const cleaned = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 180) || 'received-file';
}
function frameBytes(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'); }
function verificationCode(ownId: string, peerId: string): string {
  const colors = ['AMBER', 'BLUE', 'GREEN', 'IVORY', 'ORANGE', 'RED', 'SILVER', 'VIOLET'];
  const words = ['BEACON', 'CEDAR', 'FALCON', 'HORSE', 'LANTERN', 'RIVER', 'STONE', 'WILLOW'];
  const digest = crypto.createHash('sha256').update([ownId, peerId].sort().join('|')).digest();
  return `${colors[digest[0] % colors.length]} - ${words[digest[1] % words.length]} - ${String(digest.readUInt16BE(2) % 1000).padStart(3, '0')}`;
}
function validateCallsign(value: string): string {
  const callsign = value.trim().replace(/\s+/g, ' ');
  if (callsign.length < 2 || callsign.length > 32 || /[\u0000-\u001f<>]/.test(callsign)) throw new Error('Callsigns must contain 2 to 32 safe characters.');
  return callsign;
}
function validateGroupName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60 || /[\u0000-\u001f<>]/.test(name)) throw new Error('Relay group names must contain 2 to 60 safe characters.');
  return name;
}
function validatePhrase(value: string, label: string): string {
  if (value.length < 8 || value.length > 256) throw new Error(`${label} must contain 8 to 256 characters.`);
  return value;
}
function derivePhrase(phrase: string, salt: string): string { return crypto.scryptSync(phrase, Buffer.from(salt, 'base64'), 32).toString('base64'); }
function joinProof(verifier: string, challenge: string, groupId: string, memberId: string, ownerId: string): string {
  return crypto.createHmac('sha256', Buffer.from(verifier, 'base64')).update(`relay-group-join-v1|${challenge}|${groupId}|${memberId}|${ownerId}`).digest('base64');
}
function membershipText(value: Omit<RelayMembershipCredential, 'signature'>): string {
  return ['relay-membership-v1', value.groupId, value.groupName, value.ownerId, value.memberId, value.callsign, value.role, value.joinedAt].join('|');
}
function validMembership(value: RelayMembershipCredential): boolean {
  try {
    return typeof value.groupId === 'string' && value.groupId.length <= 80 && validateGroupName(value.groupName) === value.groupName && validateCallsign(value.callsign) === value.callsign && typeof value.ownerId === 'string' && typeof value.memberId === 'string' && value.ownerId === publicKeyId(value.ownerPublicKey) && value.memberId.length === 64 && (value.role === 'owner' || value.role === 'member') && Number.isFinite(Date.parse(value.joinedAt)) && verifySigned(value.ownerPublicKey, membershipText(value), value.signature);
  } catch { return false; }
}
function verifySigned(publicKey: string, text: string, signature: unknown): boolean {
  if (typeof signature !== 'string') return false;
  try { return crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(signature, 'base64')); } catch { return false; }
}
function socketWrite(socket: tls.TLSSocket, value: unknown): Promise<void> {
  const bytes = frameBytes(value);
  if (bytes.length > MAX_FRAME_BYTES) return Promise.reject(new Error('Relay frame is too large.'));
  return new Promise((resolve, reject) => socket.write(bytes, (error) => error ? reject(error) : resolve()));
}

class FrameReader {
  private buffer = '';
  private readonly queue: Frame[] = [];
  private readonly waiters: Array<{ resolve: (frame: Frame) => void; reject: (error: Error) => void }> = [];
  private failure?: Error;
  constructor(private readonly socket: tls.TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.receive(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('Relay connection closed.')));
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES) { this.socket.destroy(new Error('Relay frame exceeded the size limit.')); return; }
    while (true) {
      const newline = this.buffer.indexOf('\n'); if (newline < 0) return;
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      try {
        const parsed = JSON.parse(line) as Frame;
        if (!parsed || typeof parsed.type !== 'string') throw new Error('Relay frame is invalid.');
        const waiter = this.waiters.shift(); if (waiter) waiter.resolve(parsed); else this.queue.push(parsed);
      } catch { this.socket.destroy(new Error('Relay sent invalid data.')); return; }
    }
  }
  private fail(error: Error): void { if (this.failure) return; this.failure = error; while (this.waiters.length) this.waiters.shift()!.reject(error); }
  next(timeoutMs = 30_000): Promise<Frame> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (frame: Frame) => { clearTimeout(timer); resolve(frame); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1); reject(new Error('Relay peer did not respond.')); }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

export class RelayService {
  private readonly statePath: string;
  private readonly certificatePath: string;
  private readonly certificateKeyPath: string;
  private readonly options: Required<RelayOptions>;
  private stored: StoredRelayState;
  private sessionMessages: RelayMessage[] = [];
  private transfers: RelayTransfer[] = [];
  private server?: tls.Server;
  private discoverySocket?: dgram.Socket;
  private announceTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private listenPort: number | null = null;
  private certificateHash = '';
  private firewallMessage: string | null = null;
  private readonly decisions = new Map<string, PendingDecision>();
  private readonly transferSockets = new Map<string, tls.TLSSocket>();
  private readonly activeSockets = new Set<Socket>();
  private readonly joinAttemptTimes = new Map<string, number[]>();
  private readonly markerSyncTimes = new Map<string, number>();

  constructor(private readonly profile: ProfileService, private readonly paths: PortablePathService, options: RelayOptions = {}) {
    const chatRoot = paths.ensureDirectory('Data/Chat');
    const identityRoot = paths.ensureDirectory('Profile/Identity');
    paths.ensureDirectory('Downloads/Relay');
    this.statePath = path.join(chatRoot, 'relay-state.json');
    this.certificatePath = path.join(identityRoot, 'relay-tls-cert.pem');
    this.certificateKeyPath = path.join(identityRoot, 'relay-tls-private.pem');
    this.options = { discovery: options.discovery ?? true, discoveryPort: options.discoveryPort ?? DEFAULT_DISCOVERY_PORT, multicastAddress: options.multicastAddress ?? DEFAULT_MULTICAST_ADDRESS, listenPort: options.listenPort ?? 0, bindAddress: options.bindAddress ?? '0.0.0.0' };
    this.stored = this.readStored();
  }

  private readStored(): StoredRelayState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Omit<Partial<StoredRelayState>, 'version'> & { version?: number };
      if ((parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.peers) && Array.isArray(parsed.messages)) return {
        version: 2, historyEnabled: parsed.historyEnabled !== false, peers: parsed.peers, messages: parsed.messages,
        group: parsed.group ?? null, joinRequests: Array.isArray(parsed.joinRequests) ? parsed.joinRequests : [],
        securityAlerts: Array.isArray(parsed.securityAlerts) ? parsed.securityAlerts : [], sharedMarkers: Array.isArray(parsed.sharedMarkers) ? parsed.sharedMarkers : [],
      };
    } catch { /* first use */ }
    return { version: 2, historyEnabled: true, peers: [], messages: [], group: null, joinRequests: [], securityAlerts: [], sharedMarkers: [] };
  }
  private persist(): void {
    const value: StoredRelayState = { ...this.stored, messages: this.stored.historyEnabled ? this.stored.messages.slice(-1000) : [] };
    atomicJson(this.statePath, value);
  }
  private identity(): { profile: NonNullable<ReturnType<ProfileService['read']>>; publicKey: string; id: string } {
    const profile = this.profile.read(); if (!profile) throw new Error('Create your Outpost profile before starting Local Relay.');
    const publicKey = this.profile.publicKeyPem(); return { profile, publicKey, id: publicKeyId(publicKey) };
  }
  private ensureCertificate(): { cert: string; key: string } {
    if (!fs.existsSync(this.certificatePath) || !fs.existsSync(this.certificateKeyPath)) {
      const generated = generate([{ name: 'commonName', value: 'Outpost Zero Local Relay' }], { algorithm: 'sha256', days: 3650, keySize: 2048 });
      fs.writeFileSync(this.certificatePath, generated.cert, 'utf8'); fs.writeFileSync(this.certificateKeyPath, generated.private, { encoding: 'utf8', mode: 0o600 });
    }
    const cert = fs.readFileSync(this.certificatePath, 'utf8'); const key = fs.readFileSync(this.certificateKeyPath, 'utf8');
    this.certificateHash = crypto.createHash('sha256').update(new crypto.X509Certificate(cert).raw).digest('hex').toUpperCase();
    return { cert, key };
  }
  private publicPeer(peer: StoredPeer): RelayPeer {
    const ownId = this.identity().id;
    return { id: peer.id, displayName: peer.displayName, fingerprint: peer.fingerprint, address: peer.address, port: peer.port, lastSeenAt: peer.lastSeenAt, online: this.server !== undefined && Date.now() - Date.parse(peer.lastSeenAt) < 12_000, verified: peer.verified, identityChanged: peer.identityChanged, verificationCode: verificationCode(ownId, peer.id), groupId: peer.group?.groupId, groupName: peer.group?.groupName, callsign: peer.group?.callsign, groupRole: peer.group?.role, groupMember: Boolean(this.stored.group && peer.group?.groupId === this.stored.group.id && validMembership(peer.group)) };
  }
  state(): RelayState {
    const profile = this.profile.read();
    const peers = this.stored.peers.map((peer) => this.publicPeer(peer)).sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName));
    const group = this.stored.group;
    return { enabled: Boolean(this.server), port: this.listenPort, historyEnabled: this.stored.historyEnabled, identityFingerprint: profile?.deviceFingerprint ?? 'Not created', transport: 'TLS 1.3', firewallMessage: this.firewallMessage, peers, messages: [...this.stored.messages, ...this.sessionMessages].slice(-1000), transfers: this.transfers.slice(-100),
      group: group ? { id: group.id, name: group.name, callsign: group.callsign, role: group.role, ownerId: group.ownerId, memberId: this.identity().id, joiningOpen: group.joiningOpen, members: group.members.map((member) => ({ id: member.memberId, callsign: member.callsign, role: member.role, joinedAt: member.joinedAt, online: member.memberId === this.identity().id || Boolean(peers.find((peer) => peer.id === member.memberId)?.online) })) } : null,
      joinRequests: this.stored.joinRequests.slice(-100), securityAlerts: this.stored.securityAlerts.slice(-100), sharedMarkers: this.stored.sharedMarkers.filter((marker) => !marker.deleted),
    };
  }
  isRunning(): boolean { return Boolean(this.server); }
  private result(ok: boolean, message: string): RelayOperationResult { return { ok, message, state: this.state() }; }

  async start(): Promise<RelayOperationResult> {
    if (this.server?.listening) return this.result(true, `Local Relay is already listening on port ${this.listenPort}.`);
    if (this.server) await this.stop();
    const credentials = this.ensureCertificate(); this.firewallMessage = null;
    const server = tls.createServer({ ...credentials, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', requestCert: false }, (socket) => { void this.handleInbound(socket); });
    server.on('connection', (socket) => { this.activeSockets.add(socket); socket.once('close', () => this.activeSockets.delete(socket)); });
    server.on('error', (error) => { this.firewallMessage = `Local Relay could not listen on this network: ${error.message}. Outpost Zero did not change firewall settings.`; });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out while opening the Local Relay listener.')), 8_000);
        const failed = (error: Error) => { clearTimeout(timer); reject(error); };
        server.once('error', failed);
        server.listen(this.options.listenPort, this.options.bindAddress, () => { clearTimeout(timer); server.off('error', failed); resolve(); });
      });
      this.server = server; this.listenPort = (server.address() as { port: number }).port;
      if (this.options.discovery) {
        try { await this.startDiscovery(); }
        catch (error) {
          if (this.discoverySocket) { try { this.discoverySocket.close(); } catch { /* already closed */ } this.discoverySocket = undefined; }
          this.firewallMessage = `Local Relay is listening, but nearby discovery could not start: ${error instanceof Error ? error.message : 'unknown network error'}. Restart the relay after checking the network or firewall.`;
        }
      }
      return this.result(true, this.firewallMessage ? `Local Relay started on port ${this.listenPort}, but nearby discovery is unavailable.` : `Local Relay is available on this LAN using TLS 1.3. Port ${this.listenPort}.`);
    } catch (error) {
      try { server.close(); } catch { /* listener never opened */ } this.server = undefined; this.listenPort = null;
      throw error;
    }
  }
  async stop(): Promise<RelayOperationResult> {
    if (this.announceTimer) clearInterval(this.announceTimer); if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.announceTimer = undefined; this.pruneTimer = undefined;
    if (this.discoverySocket) { try { this.discoverySocket.close(); } catch { /* already closed */ } this.discoverySocket = undefined; }
    for (const socket of this.transferSockets.values()) socket.destroy(); this.transferSockets.clear();
    for (const socket of this.activeSockets) socket.destroy(); this.activeSockets.clear();
    if (this.server) { const server = this.server; this.server = undefined; await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 2_000); server.close(() => { clearTimeout(timer); resolve(); }); }); }
    this.listenPort = null; return this.result(true, 'Local Relay is stopped.');
  }
  private async startDiscovery(): Promise<void> {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); this.discoverySocket = socket;
    socket.on('message', (bytes, info) => this.receiveAnnouncement(bytes, info.address));
    socket.on('error', (error) => { this.firewallMessage = `Nearby discovery may be blocked by the host firewall: ${error.message}. Outpost Zero will not change firewall settings.`; });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Timed out while opening nearby discovery.')), 5_000); const failed = (error: Error) => { clearTimeout(timer); reject(error); }; socket.once('error', failed); socket.bind(this.options.discoveryPort, '0.0.0.0', () => { socket.off('error', failed); try { socket.addMembership(this.options.multicastAddress); socket.setMulticastTTL(1); } catch (error) { clearTimeout(timer); reject(error); return; } clearTimeout(timer); resolve(); }); });
    this.announce(); this.announceTimer = setInterval(() => this.announce(), 3_000); this.pruneTimer = setInterval(() => { /* state computes presence by time */ }, 3_000);
  }
  private announce(): void {
    if (!this.discoverySocket || !this.listenPort) return;
    const own = this.identity(); const timestamp = new Date().toISOString(); const nonce = crypto.randomBytes(12).toString('base64');
    const text = [PROTOCOL, own.id, own.profile.displayName, this.listenPort, timestamp, nonce].join('|');
    const packet = frameBytes({ protocol: PROTOCOL, id: own.id, displayName: own.profile.displayName, publicKey: own.publicKey, fingerprint: own.profile.deviceFingerprint, port: this.listenPort, timestamp, nonce, signature: this.profile.sign(Buffer.from(text)), group: this.stored.group?.credential });
    this.discoverySocket.send(packet.subarray(0, -1), this.options.discoveryPort, this.options.multicastAddress);
  }
  private receiveAnnouncement(bytes: Buffer, address: string): void {
    if (bytes.length > 16_384) return;
    try {
      const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; const own = this.identity();
      if (value.protocol !== PROTOCOL || typeof value.id !== 'string' || value.id === own.id || typeof value.publicKey !== 'string' || publicKeyId(value.publicKey) !== value.id || typeof value.displayName !== 'string' || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.timestamp !== 'string' || Math.abs(Date.now() - Date.parse(value.timestamp)) > 120_000 || typeof value.nonce !== 'string') return;
      const text = [PROTOCOL, value.id, value.displayName, value.port, value.timestamp, value.nonce].join('|'); if (!verifySigned(value.publicKey, text, value.signature)) return;
      const group = value.group as RelayMembershipCredential | undefined;
      const peer = this.rememberPeer({ id: value.id, displayName: validateDisplayName(value.displayName), fingerprint: fingerprint(value.publicKey), publicKey: value.publicKey, address, port: value.port, lastSeenAt: new Date().toISOString(), verified: false, identityChanged: false, group: group && group.memberId === value.id && validMembership(group) ? group : undefined });
      if (peer.group && this.stored.group && peer.group.groupId === this.stored.group.id && Date.now() - (this.markerSyncTimes.get(peer.id) ?? 0) > 30_000) { this.markerSyncTimes.set(peer.id, Date.now()); void this.syncOwnMarkers(peer); }
    } catch { /* ignore untrusted datagrams */ }
  }
  private rememberPeer(candidate: StoredPeer): StoredPeer {
    if (candidate.group && this.stored.group && candidate.group.groupId === this.stored.group.id && candidate.group.ownerId === this.stored.group.ownerId && validMembership(candidate.group)) this.stored.group.members = [...this.stored.group.members.filter((member) => member.memberId !== candidate.id), candidate.group];
    const existing = this.stored.peers.find((peer) => peer.id === candidate.id);
    if (existing) {
      if (existing.publicKey !== candidate.publicKey) { existing.identityChanged = true; existing.verified = false; return existing; }
      Object.assign(existing, { displayName: candidate.displayName, address: candidate.address, port: candidate.port, lastSeenAt: candidate.lastSeenAt, group: candidate.group }); this.persist(); return existing;
    }
    const replaced = this.stored.peers.find((peer) => peer.verified && peer.displayName.toLocaleLowerCase() === candidate.displayName.toLocaleLowerCase() && peer.id !== candidate.id);
    candidate.identityChanged = Boolean(replaced); this.stored.peers.push(candidate); this.persist(); return candidate;
  }

  private async handleInbound(socket: tls.TLSSocket): Promise<void> {
    const reader = new FrameReader(socket); const own = this.identity(); const challenge = crypto.randomBytes(24).toString('base64');
    try {
      const signature = this.profile.sign(Buffer.from(`relay-server-v1|${challenge}|${this.certificateHash}`));
      await socketWrite(socket, { type: 'server-hello', protocol: PROTOCOL, displayName: own.profile.displayName, publicKey: own.publicKey, id: own.id, challenge, certificateHash: this.certificateHash, signature, group: this.stored.group?.credential, joiningOpen: this.stored.group?.joiningOpen ?? false, phraseSalt: this.stored.group?.role === 'owner' ? this.stored.group.phraseSalt : undefined, duressSalt: this.stored.group?.role === 'owner' ? this.stored.group.duressSalt : undefined });
      const auth = await reader.next();
      if (auth.type !== 'client-auth' || auth.protocol !== PROTOCOL || typeof auth.publicKey !== 'string' || typeof auth.id !== 'string' || publicKeyId(auth.publicKey) !== auth.id || typeof auth.displayName !== 'string' || typeof auth.listenPort !== 'number' || !Number.isInteger(auth.listenPort) || auth.listenPort < 1 || auth.listenPort > 65535 || !verifySigned(auth.publicKey, `relay-client-v1|${challenge}|${this.certificateHash}`, auth.signature)) throw new Error('Relay identity authentication failed.');
      const authGroup = auth.group as RelayMembershipCredential | undefined;
      const peer = this.rememberPeer({ id: auth.id, displayName: validateDisplayName(auth.displayName), fingerprint: fingerprint(auth.publicKey), publicKey: auth.publicKey, address: socket.remoteAddress?.replace(/^::ffff:/, '') ?? '', port: Number(auth.listenPort) || 0, lastSeenAt: new Date().toISOString(), verified: false, identityChanged: false, group: authGroup && authGroup.memberId === auth.id && validMembership(authGroup) ? authGroup : undefined });
      await socketWrite(socket, { type: 'authenticated' });
      const command = await reader.next();
      if (command.type === 'group-join') await this.receiveGroupJoin(peer, command, challenge, socket);
      else if (command.type === 'group-grant') await this.receiveGroupGrant(peer, command, socket);
      else if (command.type === 'group-marker') await this.receiveGroupMarker(peer, command, socket);
      else if (command.type === 'group-marker-batch') await this.receiveGroupMarkerBatch(peer, command, socket);
      else if (command.type === 'group-leave') await this.receiveGroupLeave(peer, command, socket);
      else if (command.type === 'group-alert') await this.receiveGroupAlert(peer, command, socket);
      else if (command.type === 'message') { this.requireGroupPeer(peer); await this.receiveMessage(peer, command, socket); }
      else if (command.type === 'file-offer') { this.requireGroupPeer(peer); await this.receiveFile(peer, command, reader, socket); }
      else throw new Error('Relay command is unsupported.');
    } catch (error) { try { await socketWrite(socket, { type: 'error', message: error instanceof Error ? error.message : 'Relay request failed.' }); } catch { /* connection failed */ } socket.destroy(); }
  }
  private async connect(peer: StoredPeer): Promise<{ socket: tls.TLSSocket; reader: FrameReader; challenge: string; hello: Frame }> {
    if (!this.server || !this.listenPort) throw new Error('Start Local Relay before contacting another Outpost.');
    const socket = tls.connect({ host: peer.address, port: peer.port, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', servername: 'Outpost Zero Local Relay' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('The peer could not be reached. The host firewall may be blocking Local Relay.')); }, 10_000);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve(); }); socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const reader = new FrameReader(socket); const hello = await reader.next();
    const certificate = socket.getPeerCertificate(true); const certificateHash = certificate.raw ? crypto.createHash('sha256').update(certificate.raw).digest('hex').toUpperCase() : '';
    if (hello.type !== 'server-hello' || hello.protocol !== PROTOCOL || typeof hello.publicKey !== 'string' || typeof hello.id !== 'string' || hello.id !== peer.id || publicKeyId(hello.publicKey) !== hello.id || typeof hello.challenge !== 'string' || hello.certificateHash !== certificateHash || !verifySigned(hello.publicKey, `relay-server-v1|${hello.challenge}|${certificateHash}`, hello.signature)) { socket.destroy(); throw new Error('The peer identity or secure channel could not be verified.'); }
    const own = this.identity(); await socketWrite(socket, { type: 'client-auth', protocol: PROTOCOL, id: own.id, displayName: own.profile.displayName, publicKey: own.publicKey, listenPort: this.listenPort, signature: this.profile.sign(Buffer.from(`relay-client-v1|${hello.challenge}|${certificateHash}`)), group: this.stored.group?.credential });
    const authenticated = await reader.next(); if (authenticated.type !== 'authenticated') { socket.destroy(); throw new Error('The peer rejected identity authentication.'); }
    peer.lastSeenAt = new Date().toISOString(); this.persist(); return { socket, reader, challenge: hello.challenge, hello };
  }

  private makeCredential(groupId: string, groupName: string, memberId: string, callsign: string, role: 'owner' | 'member', joinedAt = new Date().toISOString()): RelayMembershipCredential {
    const own = this.identity(); const unsigned = { groupId, groupName, ownerId: own.id, ownerPublicKey: own.publicKey, memberId, callsign, role, joinedAt };
    return { ...unsigned, signature: this.profile.sign(Buffer.from(membershipText(unsigned))) };
  }
  private requireGroupPeer(peer: StoredPeer): StoredGroup {
    const group = this.stored.group;
    if (!group || !peer.group || peer.group.groupId !== group.id || !validMembership(peer.group) || peer.group.ownerId !== group.ownerId) throw new Error('This device is not an approved member of the relay group.');
    return group;
  }
  createGroup(name: string, callsign: string, phrase: string, duressPhrase: string): RelayOperationResult {
    if (this.stored.group) return this.result(false, 'Leave the current relay group before creating another one.');
    const groupName = validateGroupName(name); const ownCallsign = validateCallsign(callsign); const joinPhrase = validatePhrase(phrase, 'Join phrase'); const deadman = validatePhrase(duressPhrase, 'Deadman phrase');
    if (crypto.timingSafeEqual(crypto.createHash('sha256').update(joinPhrase).digest(), crypto.createHash('sha256').update(deadman).digest())) return this.result(false, 'The join phrase and deadman phrase must be different.');
    const own = this.identity(); const id = crypto.randomUUID(); const phraseSalt = crypto.randomBytes(16).toString('base64'); const duressSalt = crypto.randomBytes(16).toString('base64');
    const credential = this.makeCredential(id, groupName, own.id, ownCallsign, 'owner');
    this.stored.group = { id, name: groupName, ownerId: own.id, ownerPublicKey: own.publicKey, callsign: ownCallsign, role: 'owner', joiningOpen: true, credential, phraseSalt, phraseVerifier: derivePhrase(joinPhrase, phraseSalt), duressSalt, duressVerifier: derivePhrase(deadman, duressSalt), members: [credential] };
    this.stored.joinRequests = []; this.stored.securityAlerts = []; this.stored.sharedMarkers = []; this.persist(); this.announce();
    return this.result(true, `${groupName} created. Nearby devices need the join phrase and your approval.`);
  }
  async requestJoin(peerId: string, callsign: string, phrase: string): Promise<RelayOperationResult> {
    if (this.stored.group) return this.result(false, 'Leave the current relay group before joining another one.');
    const peer = this.stored.peers.find((item) => item.id === peerId); if (!peer) return this.result(false, 'That relay station is no longer available.');
    const claimedCallsign = validateCallsign(callsign); const supplied = validatePhrase(phrase, 'Relay phrase');
    try {
      const { socket, reader, challenge, hello } = await this.connect(peer); const group = hello.group as RelayMembershipCredential | undefined;
      if (!group || group.role !== 'owner' || group.memberId !== peer.id || !validMembership(group) || hello.joiningOpen !== true || typeof hello.phraseSalt !== 'string' || typeof hello.duressSalt !== 'string') throw new Error('That station is not accepting relay-group joins.');
      const proof = joinProof(derivePhrase(supplied, hello.phraseSalt), challenge, group.groupId, this.identity().id, group.ownerId);
      const duressProof = joinProof(derivePhrase(supplied, hello.duressSalt), challenge, group.groupId, this.identity().id, group.ownerId);
      await socketWrite(socket, { type: 'group-join', groupId: group.groupId, callsign: claimedCallsign, proof, duressProof });
      const response = await reader.next(); socket.end(); if (response.type !== 'join-request-ack') throw new Error('The relay station did not accept the join request.');
      return this.result(true, 'Join request sent. The group owner must approve this device.');
    } catch (error) { return this.result(false, error instanceof Error ? error.message : 'Could not request relay-group access.'); }
  }
  private async receiveGroupJoin(peer: StoredPeer, command: Frame, challenge: string, socket: tls.TLSSocket): Promise<void> {
    const group = this.stored.group; if (!group || group.role !== 'owner' || !group.joiningOpen || typeof command.groupId !== 'string' || command.groupId !== group.id || typeof command.callsign !== 'string' || typeof command.proof !== 'string' || typeof command.duressProof !== 'string' || !group.phraseVerifier || !group.duressVerifier) throw new Error('Relay-group joining is unavailable.');
    const now = Date.now(); const attempts = (this.joinAttemptTimes.get(peer.id) ?? []).filter((value) => now - value < 10 * 60_000); if (attempts.length >= 5) throw new Error('Too many join attempts. Try again later.'); attempts.push(now); this.joinAttemptTimes.set(peer.id, attempts);
    const callsign = validateCallsign(command.callsign); const normal = joinProof(group.phraseVerifier, challenge, group.id, peer.id, group.ownerId); const duress = joinProof(group.duressVerifier, challenge, group.id, peer.id, group.ownerId);
    const normalMatch = command.proof.length === normal.length && crypto.timingSafeEqual(Buffer.from(command.proof), Buffer.from(normal));
    const duressMatch = command.duressProof.length === duress.length && crypto.timingSafeEqual(Buffer.from(command.duressProof), Buffer.from(duress));
    await socketWrite(socket, { type: 'join-request-ack', status: 'pending' }); socket.end();
    if (duressMatch) {
      const recent = this.stored.securityAlerts.some((item) => item.fingerprint === peer.fingerprint && Date.now() - Date.parse(item.occurredAt) < 60_000);
      if (!recent) { const alert: RelaySecurityAlert = { id: crypto.randomUUID(), kind: 'duress-join', callsign, fingerprint: peer.fingerprint, occurredAt: new Date().toISOString(), message: `Deadman phrase entered by ${callsign}. This device was not admitted.`, read: false }; this.stored.securityAlerts.push(alert); this.persist(); void this.broadcastAlert(alert); }
      return;
    }
    if (!normalMatch) return;
    const existing = this.stored.joinRequests.find((item) => item.peerId === peer.id && item.status === 'pending');
    if (!existing) { this.stored.joinRequests.push({ id: crypto.randomUUID(), peerId: peer.id, callsign, fingerprint: peer.fingerprint, requestedAt: new Date().toISOString(), status: 'pending' }); this.persist(); }
  }
  async approveJoin(requestId: string): Promise<RelayOperationResult> {
    const group = this.stored.group; if (!group || group.role !== 'owner') return this.result(false, 'Only the relay-group owner can approve members.');
    const request = this.stored.joinRequests.find((item) => item.id === requestId && item.status === 'pending'); if (!request) return this.result(false, 'That join request is no longer pending.');
    const peer = this.stored.peers.find((item) => item.id === request.peerId); if (!peer) return this.result(false, 'The requesting device is no longer known.');
    const credential = this.makeCredential(group.id, group.name, peer.id, request.callsign, 'member');
    try {
      const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'group-grant', group: { id: group.id, name: group.name, ownerId: group.ownerId, ownerPublicKey: group.ownerPublicKey, joiningOpen: group.joiningOpen }, credential, ownerCredential: group.credential });
      const ack = await reader.next(); socket.end(); if (ack.type !== 'group-grant-ack') throw new Error('The device did not confirm group membership.');
      request.status = 'approved'; peer.group = credential; peer.verified = true; peer.identityChanged = false; group.members = [...group.members.filter((item) => item.memberId !== peer.id), credential]; this.persist(); this.announce();
      return this.result(true, `${request.callsign} joined ${group.name}.`);
    } catch (error) { return this.result(false, error instanceof Error ? error.message : 'Could not deliver the membership approval.'); }
  }
  rejectJoin(requestId: string): RelayOperationResult { const request = this.stored.joinRequests.find((item) => item.id === requestId && item.status === 'pending'); if (!request) return this.result(false, 'That join request is no longer pending.'); request.status = 'rejected'; this.persist(); return this.result(true, `${request.callsign} was not admitted.`); }
  private async receiveGroupGrant(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> {
    if (this.stored.group) throw new Error('This device already belongs to a relay group.'); const credential = command.credential as RelayMembershipCredential | undefined; const ownerCredential = command.ownerCredential as RelayMembershipCredential | undefined; const value = command.group as { id?: unknown; name?: unknown; ownerId?: unknown; ownerPublicKey?: unknown; joiningOpen?: unknown } | undefined; const ownId = this.identity().id;
    if (!credential || !ownerCredential || !value || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.ownerId !== 'string' || typeof value.ownerPublicKey !== 'string' || credential.memberId !== ownId || credential.groupId !== value.id || credential.ownerId !== peer.id || ownerCredential.memberId !== peer.id || !validMembership(credential) || !validMembership(ownerCredential)) throw new Error('The relay membership grant is invalid.');
    this.stored.group = { id: value.id, name: validateGroupName(value.name), ownerId: peer.id, ownerPublicKey: value.ownerPublicKey, callsign: credential.callsign, role: 'member', joiningOpen: value.joiningOpen === true, credential, members: [ownerCredential, credential] }; peer.group = ownerCredential; peer.verified = true; peer.identityChanged = false; this.persist(); this.announce(); await socketWrite(socket, { type: 'group-grant-ack' }); socket.end();
  }
  async leaveGroup(): Promise<RelayOperationResult> { const group = this.stored.group; if (!group) return this.result(false, 'This device is not in a relay group.'); const peers = this.stored.peers.filter((peer) => { try { this.requireGroupPeer(peer); return this.publicPeer(peer).online; } catch { return false; } }); await Promise.allSettled(peers.map(async (peer) => { const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'group-leave', groupId: group.id, memberId: this.identity().id, ownerLeaving: group.role === 'owner' }); await reader.next(); socket.end(); })); this.stored.group = null; this.stored.joinRequests = []; this.stored.securityAlerts = []; this.stored.sharedMarkers = []; this.stored.messages = []; this.sessionMessages = []; this.persist(); this.announce(); return this.result(true, `Left ${group.name}. This device can now join or create another relay group.`); }
  updatePhrases(phrase: string, duressPhrase: string): RelayOperationResult { const group = this.stored.group; if (!group || group.role !== 'owner') return this.result(false, 'Only the relay-group owner can change joining phrases.'); const normal = validatePhrase(phrase, 'Join phrase'); const duress = validatePhrase(duressPhrase, 'Deadman phrase'); if (normal === duress) return this.result(false, 'The join phrase and deadman phrase must be different.'); group.phraseSalt = crypto.randomBytes(16).toString('base64'); group.duressSalt = crypto.randomBytes(16).toString('base64'); group.phraseVerifier = derivePhrase(normal, group.phraseSalt); group.duressVerifier = derivePhrase(duress, group.duressSalt); this.persist(); return this.result(true, 'Future join phrases changed. Existing approved members remain connected.'); }
  setJoiningOpen(open: boolean): RelayOperationResult { const group = this.stored.group; if (!group || group.role !== 'owner') return this.result(false, 'Only the relay-group owner can control joining.'); group.joiningOpen = open; this.persist(); this.announce(); return this.result(true, open ? 'Joining is open.' : 'Joining is closed; approved members remain connected.'); }
  markSecurityAlertsRead(): RelayState { for (const alert of this.stored.securityAlerts) alert.read = true; this.persist(); return this.state(); }
  private async broadcastAlert(alert: RelaySecurityAlert): Promise<void> { const peers = this.stored.peers.filter((peer) => { try { this.requireGroupPeer(peer); return this.publicPeer(peer).online; } catch { return false; } }); await Promise.allSettled(peers.map(async (peer) => { const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'group-alert', alert }); await reader.next(); socket.end(); })); }
  private async receiveGroupAlert(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> { const group = this.requireGroupPeer(peer); if (peer.id !== group.ownerId) throw new Error('Only the group owner can issue a join-security alert.'); const alert = command.alert as RelaySecurityAlert | undefined; if (!alert || alert.kind !== 'duress-join' || typeof alert.id !== 'string' || typeof alert.callsign !== 'string' || typeof alert.fingerprint !== 'string' || typeof alert.occurredAt !== 'string' || typeof alert.message !== 'string') throw new Error('Relay security alert is invalid.'); if (!this.stored.securityAlerts.some((item) => item.id === alert.id)) { this.stored.securityAlerts.push({ ...alert, read: false }); this.persist(); } await socketWrite(socket, { type: 'group-alert-ack' }); socket.end(); }
  saveMarker(input: { id?: string; title: string; category: RelaySharedMarker['category']; note: string; latitude: number; longitude: number }): RelayOperationResult {
    const group = this.stored.group; if (!group) return this.result(false, 'Join or create a relay group before sharing map markers.');
    const title = input.title.trim(); const note = input.note.trim(); if (title.length < 1 || title.length > 80 || note.length > 500 || !['general', 'hazard', 'medical', 'supply', 'rally', 'observation'].includes(input.category) || !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) return this.result(false, 'Shared marker details are invalid.');
    const own = this.identity(); const current = input.id ? this.stored.sharedMarkers.find((item) => item.id === input.id && item.authorId === own.id) : undefined;
    const marker: RelaySharedMarker = { id: current?.id ?? crypto.randomUUID(), groupId: group.id, title, category: input.category, note, latitude: input.latitude, longitude: input.longitude, authorId: own.id, authorCallsign: group.callsign, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), deleted: false };
    this.mergeMarker(marker); this.persist(); void this.broadcastMarker(marker); return this.result(true, `${title} shared with online group members.`);
  }
  deleteMarker(markerId: string): RelayOperationResult { const group = this.stored.group; const own = this.identity(); const current = this.stored.sharedMarkers.find((item) => item.id === markerId && item.groupId === group?.id); if (!group || !current || current.authorId !== own.id) return this.result(false, 'Only the marker author can remove this shared marker.'); const deleted = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), deleted: true }; this.mergeMarker(deleted); this.persist(); void this.broadcastMarker(deleted); return this.result(true, `${current.title} removed from the shared map.`); }
  private mergeMarker(marker: RelaySharedMarker): void { const current = this.stored.sharedMarkers.find((item) => item.id === marker.id); if (current && current.revision >= marker.revision) return; this.stored.sharedMarkers = [...this.stored.sharedMarkers.filter((item) => item.id !== marker.id), marker].slice(-2000); }
  private async broadcastMarker(marker: RelaySharedMarker): Promise<void> { const peers = this.stored.peers.filter((peer) => { try { this.requireGroupPeer(peer); return this.publicPeer(peer).online; } catch { return false; } }); await Promise.allSettled(peers.map(async (peer) => { const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'group-marker', marker }); await reader.next(); socket.end(); })); }
  private async syncOwnMarkers(peer: StoredPeer): Promise<void> { try { this.requireGroupPeer(peer); const ownId = this.identity().id; const markers = this.stored.sharedMarkers.filter((marker) => marker.authorId === ownId); if (!markers.length) return; const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'group-marker-batch', markers }); await reader.next(); socket.end(); } catch { /* peer may disappear between discovery and synchronization */ } }
  private async receiveGroupMarker(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> { const group = this.requireGroupPeer(peer); const marker = command.marker as RelaySharedMarker | undefined; if (!marker || marker.groupId !== group.id || marker.authorId !== peer.id || typeof marker.id !== 'string' || typeof marker.title !== 'string' || marker.title.length < 1 || marker.title.length > 80 || typeof marker.note !== 'string' || marker.note.length > 500 || !['general', 'hazard', 'medical', 'supply', 'rally', 'observation'].includes(marker.category) || !Number.isInteger(marker.revision) || marker.revision < 1 || !Number.isFinite(marker.latitude) || marker.latitude < -90 || marker.latitude > 90 || !Number.isFinite(marker.longitude) || marker.longitude < -180 || marker.longitude > 180 || typeof marker.deleted !== 'boolean') throw new Error('Shared relay marker is invalid.'); this.mergeMarker(marker); this.persist(); await socketWrite(socket, { type: 'group-marker-ack' }); socket.end(); }
  private async receiveGroupMarkerBatch(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> { const group = this.requireGroupPeer(peer); if (!Array.isArray(command.markers) || command.markers.length > 2000) throw new Error('Shared marker synchronization is invalid.'); for (const value of command.markers) { const marker = value as RelaySharedMarker; if (!marker || marker.groupId !== group.id || marker.authorId !== peer.id || typeof marker.id !== 'string' || typeof marker.title !== 'string' || marker.title.length > 80 || typeof marker.note !== 'string' || marker.note.length > 500 || !Number.isInteger(marker.revision) || marker.revision < 1 || !Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude) || typeof marker.deleted !== 'boolean') throw new Error('Shared marker synchronization is invalid.'); this.mergeMarker(marker); } this.persist(); await socketWrite(socket, { type: 'group-marker-batch-ack' }); socket.end(); }
  private async receiveGroupLeave(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> { const group = this.requireGroupPeer(peer); if (command.groupId !== group.id || command.memberId !== peer.id || typeof command.ownerLeaving !== 'boolean') throw new Error('Relay departure notice is invalid.'); if (peer.id === group.ownerId && command.ownerLeaving) { this.stored.group = null; this.stored.sharedMarkers = []; this.stored.messages = []; this.sessionMessages = []; } else { group.members = group.members.filter((member) => member.memberId !== peer.id); peer.group = undefined; } this.persist(); await socketWrite(socket, { type: 'group-leave-ack' }); socket.end(); }

  private addMessage(message: RelayMessage): void {
    if (this.stored.historyEnabled) { this.stored.messages.push(message); this.stored.messages = this.stored.messages.slice(-1000); this.persist(); }
    else this.sessionMessages.push(message);
  }
  private async receiveMessage(peer: StoredPeer, command: Frame, socket: tls.TLSSocket): Promise<void> {
    if (typeof command.id !== 'string' || typeof command.body !== 'string' || command.body.length < 1 || command.body.length > MAX_MESSAGE_LENGTH || (command.scope !== 'direct' && command.scope !== 'room') || typeof command.sentAt !== 'string') throw new Error('Relay message is invalid.');
    if ([...this.stored.messages, ...this.sessionMessages].some((message) => message.id === command.id)) throw new Error('Relay message replay was rejected.');
    this.addMessage({ id: command.id, peerId: peer.id, scope: command.scope, direction: 'incoming', senderName: peer.displayName, body: command.body, sentAt: command.sentAt, delivered: true, read: false });
    await socketWrite(socket, { type: 'message-ack', id: command.id }); socket.end();
  }
  async sendMessage(peerId: string, scope: 'direct' | 'room', body: string): Promise<RelayOperationResult> {
    const text = body.trim(); if (!text || text.length > MAX_MESSAGE_LENGTH) return this.result(false, `Messages must contain 1 to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
    if (!this.stored.group) return this.result(false, 'Join or create a relay group before sending messages.');
    if (scope === 'room') {
      const peers = this.stored.peers.filter((peer) => { try { this.requireGroupPeer(peer); return this.publicPeer(peer).online; } catch { return false; } }); if (!peers.length) return this.result(false, 'No approved group members are online.');
      const id = crypto.randomUUID(); const sentAt = new Date().toISOString(); const outcomes = await Promise.allSettled(peers.map((peer) => this.sendMessageFrame(peer, id, 'room', text, sentAt)));
      const delivered = outcomes.filter((item) => item.status === 'fulfilled').length; this.addMessage({ id, peerId: 'room', scope: 'room', direction: 'outgoing', senderName: this.identity().profile.displayName, body: text, sentAt, delivered: delivered > 0, read: true });
      return this.result(delivered > 0, `Room message delivered to ${delivered} of ${peers.length} nearby Outposts.`);
    }
    const peer = this.stored.peers.find((item) => item.id === peerId); if (!peer) return this.result(false, 'That peer is no longer known.');
    try { this.requireGroupPeer(peer); } catch { return this.result(false, 'That device is not an approved member of this relay group.'); }
    const id = crypto.randomUUID(); const sentAt = new Date().toISOString();
    try { await this.sendMessageFrame(peer, id, 'direct', text, sentAt); this.addMessage({ id, peerId, scope, direction: 'outgoing', senderName: this.identity().profile.displayName, body: text, sentAt, delivered: true, read: true }); return this.result(true, `Message delivered securely to ${peer.displayName}.`); }
    catch (error) { this.firewallMessage = 'The peer could not be reached. A host firewall may be blocking Local Relay; Outpost Zero did not change firewall settings.'; this.addMessage({ id, peerId, scope, direction: 'outgoing', senderName: this.identity().profile.displayName, body: text, sentAt, delivered: false, read: true }); return this.result(false, error instanceof Error ? error.message : 'Message delivery failed.'); }
  }
  private async sendMessageFrame(peer: StoredPeer, id: string, scope: 'direct' | 'room', body: string, sentAt: string): Promise<void> {
    const { socket, reader } = await this.connect(peer); await socketWrite(socket, { type: 'message', id, scope, body, sentAt }); const ack = await reader.next(); socket.end(); if (ack.type !== 'message-ack' || ack.id !== id) throw new Error('The peer did not confirm delivery.');
  }

  verifyPeer(peerId: string): RelayState { const peer = this.stored.peers.find((item) => item.id === peerId); if (!peer) throw new Error('Peer not found.'); peer.verified = true; peer.identityChanged = false; this.persist(); return this.state(); }
  forgetPeer(peerId: string): RelayState { this.stored.peers = this.stored.peers.filter((peer) => peer.id !== peerId); this.stored.messages = this.stored.messages.filter((message) => message.peerId !== peerId); this.sessionMessages = this.sessionMessages.filter((message) => message.peerId !== peerId); this.persist(); return this.state(); }
  setHistory(enabled: boolean): RelayState { this.stored.historyEnabled = enabled; if (!enabled) this.stored.messages = []; this.persist(); return this.state(); }
  markRead(peerId: string, scope: 'direct' | 'room'): RelayState { for (const message of [...this.stored.messages, ...this.sessionMessages]) if (message.scope === scope && (scope === 'room' || message.peerId === peerId)) message.read = true; this.persist(); return this.state(); }

  async sendFile(peerId: string, filePath: string): Promise<RelayOperationResult> {
    const peer = this.stored.peers.find((item) => item.id === peerId); if (!peer) return this.result(false, 'Select a known peer first.');
    try { this.requireGroupPeer(peer); } catch { return this.result(false, 'Files can only be sent to approved relay-group members.'); }
    const stats = fs.statSync(filePath); if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TRANSFER_BYTES) return this.result(false, 'Files must be between 1 byte and 2 GB.');
    const id = crypto.randomUUID(); const transfer: RelayTransfer = { id, peerId, peerName: peer.displayName, direction: 'outgoing', fileName: safeName(filePath), size: stats.size, sha256: '', status: 'waiting', transferredBytes: 0, message: 'Calculating SHA-256 before offering the file.' }; this.transfers.push(transfer);
    void this.runOutgoingFile(peer, filePath, transfer); return this.result(true, `File offer prepared for ${peer.displayName}.`);
  }
  private async runOutgoingFile(peer: StoredPeer, filePath: string, transfer: RelayTransfer): Promise<void> {
    try {
      const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer); transfer.sha256 = hash.digest('hex').toUpperCase(); transfer.message = 'Waiting for the recipient to accept.';
      const { socket, reader } = await this.connect(peer); this.transferSockets.set(transfer.id, socket);
      await socketWrite(socket, { type: 'file-offer', id: transfer.id, fileName: transfer.fileName, size: transfer.size, sha256: transfer.sha256 });
      const response = await reader.next(5 * 60_000); if (response.type !== 'file-response' || response.id !== transfer.id || response.accept !== true) { transfer.status = 'declined'; transfer.message = 'The recipient declined the file.'; socket.end(); return; }
      transfer.status = 'transferring'; transfer.message = 'Encrypted transfer in progress.';
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        if ((transfer as RelayTransfer).status === 'cancelled') { await socketWrite(socket, { type: 'file-cancel', id: transfer.id }); socket.end(); return; }
        const bytes = chunk as Buffer; await socketWrite(socket, { type: 'file-chunk', id: transfer.id, data: bytes.toString('base64') }); transfer.transferredBytes += bytes.length;
      }
      await socketWrite(socket, { type: 'file-end', id: transfer.id }); const complete = await reader.next(60_000); if (complete.type !== 'file-complete' || complete.id !== transfer.id) throw new Error('The recipient did not confirm file verification.');
      transfer.status = 'complete'; transfer.transferredBytes = transfer.size; transfer.message = 'Recipient verified and saved the file.'; socket.end();
    } catch (error) { transfer.status = transfer.status === 'cancelled' ? 'cancelled' : 'error'; transfer.message = error instanceof Error ? error.message : 'File transfer failed.'; }
    finally { this.transferSockets.delete(transfer.id); }
  }
  private async receiveFile(peer: StoredPeer, command: Frame, reader: FrameReader, socket: tls.TLSSocket): Promise<void> {
    if (typeof command.id !== 'string' || typeof command.fileName !== 'string' || typeof command.size !== 'number' || !Number.isSafeInteger(command.size) || command.size <= 0 || command.size > MAX_TRANSFER_BYTES || typeof command.sha256 !== 'string' || !/^[A-F0-9]{64}$/i.test(command.sha256)) throw new Error('File offer is invalid.');
    if (this.transfers.some((transfer) => transfer.id === command.id)) throw new Error('Relay file-offer replay was rejected.');
    const transfer: RelayTransfer = { id: command.id, peerId: peer.id, peerName: peer.displayName, direction: 'incoming', fileName: safeName(command.fileName), size: command.size, sha256: command.sha256.toUpperCase(), status: 'offered', transferredBytes: 0, message: 'Waiting for your decision.' }; this.transfers.push(transfer); this.transferSockets.set(transfer.id, socket);
    const decision = await new Promise<{ accept: boolean; destination?: string; relativePath?: string }>((resolve) => this.decisions.set(transfer.id, { resolve })); this.decisions.delete(transfer.id);
    if (!decision.accept || !decision.destination || !decision.relativePath) { transfer.status = 'declined'; transfer.message = 'File declined.'; await socketWrite(socket, { type: 'file-response', id: transfer.id, accept: false }); socket.end(); this.transferSockets.delete(transfer.id); return; }
    await socketWrite(socket, { type: 'file-response', id: transfer.id, accept: true }); transfer.status = 'transferring'; transfer.message = 'Receiving encrypted chunks.';
    const partial = this.paths.resolve(`Downloads/Relay/${transfer.id}.partial`); const output = fs.createWriteStream(partial); const hash = crypto.createHash('sha256');
    try {
      while (true) {
        const frame = await reader.next(60_000);
        if (frame.type === 'file-cancel') throw new Error('The sender cancelled the transfer.');
        if (frame.type === 'file-end') break;
        if (frame.type !== 'file-chunk' || frame.id !== transfer.id || typeof frame.data !== 'string') throw new Error('Received an invalid file chunk.');
        const bytes = Buffer.from(frame.data, 'base64'); if (transfer.transferredBytes + bytes.length > transfer.size) throw new Error('Incoming file exceeded its declared size.');
        hash.update(bytes); transfer.transferredBytes += bytes.length; if (!output.write(bytes)) await new Promise<void>((resolve) => output.once('drain', () => resolve()));
      }
      await new Promise<void>((resolve, reject) => { output.end(); output.once('finish', resolve); output.once('error', reject); });
      if (transfer.transferredBytes !== transfer.size || hash.digest('hex').toUpperCase() !== transfer.sha256) throw new Error('Incoming file failed SHA-256 verification.');
      fs.mkdirSync(path.dirname(decision.destination), { recursive: true }); fs.renameSync(partial, decision.destination); transfer.status = 'complete'; transfer.relativePath = decision.relativePath; transfer.message = `Saved to ${decision.relativePath}.`; await socketWrite(socket, { type: 'file-complete', id: transfer.id }); socket.end();
    } catch (error) { output.destroy(); if (fs.existsSync(partial)) fs.rmSync(partial, { force: true }); transfer.status = (transfer as RelayTransfer).status === 'cancelled' ? 'cancelled' : 'error'; transfer.message = error instanceof Error ? error.message : 'Incoming transfer failed.'; socket.destroy(); }
    finally { this.transferSockets.delete(transfer.id); }
  }
  acceptFile(transferId: string, destination: 'documents' | 'media' | 'custom'): RelayOperationResult {
    const transfer = this.transfers.find((item) => item.id === transferId && item.direction === 'incoming'); const pending = this.decisions.get(transferId); if (!transfer || !pending || transfer.status !== 'offered') return this.result(false, 'That file offer is no longer waiting.');
    const roots = { documents: 'Content/Documents', media: 'Content/Media', custom: 'Content/Custom' } as const; const root = roots[destination]; let fileName = safeName(transfer.fileName); let relativePath = `${root}/${fileName}`; let target = this.paths.resolve(relativePath); let suffix = 2;
    while (fs.existsSync(target)) { const extension = path.extname(fileName); const stem = path.basename(fileName, extension); relativePath = `${root}/${stem} (${suffix++})${extension}`; target = this.paths.resolve(relativePath); }
    pending.resolve({ accept: true, destination: target, relativePath }); transfer.status = 'waiting'; transfer.message = 'Acceptance sent to sender.'; return this.result(true, `Receiving ${transfer.fileName} into ${root}.`);
  }
  declineFile(transferId: string): RelayOperationResult { const transfer = this.transfers.find((item) => item.id === transferId); const pending = this.decisions.get(transferId); if (!transfer || !pending) return this.result(false, 'That file offer is no longer waiting.'); transfer.status = 'declined'; pending.resolve({ accept: false }); return this.result(true, 'File declined.'); }
  cancelTransfer(transferId: string): RelayOperationResult { const transfer = this.transfers.find((item) => item.id === transferId); if (!transfer || !['waiting', 'transferring', 'offered'].includes(transfer.status)) return this.result(false, 'That transfer is not active.'); const pending = this.decisions.get(transferId); if (pending) pending.resolve({ accept: false }); transfer.status = 'cancelled'; transfer.message = 'Transfer cancelled.'; this.transferSockets.get(transferId)?.destroy(); return this.result(true, 'Transfer cancelled.'); }
}
