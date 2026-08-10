import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { generate } from 'selfsigned';
import type { RelayMessage, RelayOperationResult, RelayPeer, RelayState, RelayTransfer } from '../shared/contracts';
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
}
interface StoredRelayState { version: 1; historyEnabled: boolean; peers: StoredPeer[]; messages: RelayMessage[]; }
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
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as StoredRelayState;
      if (parsed.version === 1 && Array.isArray(parsed.peers) && Array.isArray(parsed.messages)) return parsed;
    } catch { /* first use */ }
    return { version: 1, historyEnabled: true, peers: [], messages: [] };
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
    return { id: peer.id, displayName: peer.displayName, fingerprint: peer.fingerprint, address: peer.address, port: peer.port, lastSeenAt: peer.lastSeenAt, online: this.server !== undefined && Date.now() - Date.parse(peer.lastSeenAt) < 12_000, verified: peer.verified, identityChanged: peer.identityChanged, verificationCode: verificationCode(ownId, peer.id) };
  }
  state(): RelayState {
    const profile = this.profile.read();
    return { enabled: Boolean(this.server), port: this.listenPort, historyEnabled: this.stored.historyEnabled, identityFingerprint: profile?.deviceFingerprint ?? 'Not created', transport: 'TLS 1.3', firewallMessage: this.firewallMessage, peers: this.stored.peers.map((peer) => this.publicPeer(peer)).sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName)), messages: [...this.stored.messages, ...this.sessionMessages].slice(-1000), transfers: this.transfers.slice(-100) };
  }
  isRunning(): boolean { return Boolean(this.server); }
  private result(ok: boolean, message: string): RelayOperationResult { return { ok, message, state: this.state() }; }

  async start(): Promise<RelayOperationResult> {
    if (this.server) return this.result(true, `Local Relay is already listening on port ${this.listenPort}.`);
    const credentials = this.ensureCertificate(); this.firewallMessage = null;
    this.server = tls.createServer({ ...credentials, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', requestCert: false }, (socket) => { void this.handleInbound(socket); });
    this.server.on('error', (error) => { this.firewallMessage = `Local Relay could not listen on this network: ${error.message}. Outpost Zero did not change firewall settings.`; });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.options.listenPort, this.options.bindAddress, () => { this.server!.off('error', reject); resolve(); }); });
    this.listenPort = (this.server.address() as { port: number }).port;
    if (this.options.discovery) await this.startDiscovery();
    return this.result(true, `Local Relay is available on this LAN using TLS 1.3. Port ${this.listenPort}.`);
  }
  async stop(): Promise<RelayOperationResult> {
    if (this.announceTimer) clearInterval(this.announceTimer); if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.announceTimer = undefined; this.pruneTimer = undefined;
    if (this.discoverySocket) { try { this.discoverySocket.close(); } catch { /* already closed */ } this.discoverySocket = undefined; }
    for (const socket of this.transferSockets.values()) socket.destroy(); this.transferSockets.clear();
    if (this.server) { const server = this.server; this.server = undefined; await new Promise<void>((resolve) => server.close(() => resolve())); }
    this.listenPort = null; return this.result(true, 'Local Relay is stopped.');
  }
  private async startDiscovery(): Promise<void> {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); this.discoverySocket = socket;
    socket.on('message', (bytes, info) => this.receiveAnnouncement(bytes, info.address));
    socket.on('error', (error) => { this.firewallMessage = `Nearby discovery may be blocked by the host firewall: ${error.message}. Outpost Zero will not change firewall settings.`; });
    await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(this.options.discoveryPort, '0.0.0.0', () => { socket.off('error', reject); try { socket.addMembership(this.options.multicastAddress); socket.setMulticastTTL(1); } catch (error) { reject(error); return; } resolve(); }); });
    this.announce(); this.announceTimer = setInterval(() => this.announce(), 3_000); this.pruneTimer = setInterval(() => { /* state computes presence by time */ }, 3_000);
  }
  private announce(): void {
    if (!this.discoverySocket || !this.listenPort) return;
    const own = this.identity(); const timestamp = new Date().toISOString(); const nonce = crypto.randomBytes(12).toString('base64');
    const text = [PROTOCOL, own.id, own.profile.displayName, this.listenPort, timestamp, nonce].join('|');
    const packet = frameBytes({ protocol: PROTOCOL, id: own.id, displayName: own.profile.displayName, publicKey: own.publicKey, fingerprint: own.profile.deviceFingerprint, port: this.listenPort, timestamp, nonce, signature: this.profile.sign(Buffer.from(text)) });
    this.discoverySocket.send(packet.subarray(0, -1), this.options.discoveryPort, this.options.multicastAddress);
  }
  private receiveAnnouncement(bytes: Buffer, address: string): void {
    if (bytes.length > 16_384) return;
    try {
      const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; const own = this.identity();
      if (value.protocol !== PROTOCOL || typeof value.id !== 'string' || value.id === own.id || typeof value.publicKey !== 'string' || publicKeyId(value.publicKey) !== value.id || typeof value.displayName !== 'string' || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.timestamp !== 'string' || Math.abs(Date.now() - Date.parse(value.timestamp)) > 120_000 || typeof value.nonce !== 'string') return;
      const text = [PROTOCOL, value.id, value.displayName, value.port, value.timestamp, value.nonce].join('|'); if (!verifySigned(value.publicKey, text, value.signature)) return;
      this.rememberPeer({ id: value.id, displayName: validateDisplayName(value.displayName), fingerprint: fingerprint(value.publicKey), publicKey: value.publicKey, address, port: value.port, lastSeenAt: new Date().toISOString(), verified: false, identityChanged: false });
    } catch { /* ignore untrusted datagrams */ }
  }
  private rememberPeer(candidate: StoredPeer): StoredPeer {
    const existing = this.stored.peers.find((peer) => peer.id === candidate.id);
    if (existing) {
      if (existing.publicKey !== candidate.publicKey) { existing.identityChanged = true; existing.verified = false; return existing; }
      Object.assign(existing, { displayName: candidate.displayName, address: candidate.address, port: candidate.port, lastSeenAt: candidate.lastSeenAt }); this.persist(); return existing;
    }
    const replaced = this.stored.peers.find((peer) => peer.verified && peer.displayName.toLocaleLowerCase() === candidate.displayName.toLocaleLowerCase() && peer.id !== candidate.id);
    candidate.identityChanged = Boolean(replaced); this.stored.peers.push(candidate); this.persist(); return candidate;
  }

  private async handleInbound(socket: tls.TLSSocket): Promise<void> {
    const reader = new FrameReader(socket); const own = this.identity(); const challenge = crypto.randomBytes(24).toString('base64');
    try {
      const signature = this.profile.sign(Buffer.from(`relay-server-v1|${challenge}|${this.certificateHash}`));
      await socketWrite(socket, { type: 'server-hello', protocol: PROTOCOL, displayName: own.profile.displayName, publicKey: own.publicKey, id: own.id, challenge, certificateHash: this.certificateHash, signature });
      const auth = await reader.next();
      if (auth.type !== 'client-auth' || auth.protocol !== PROTOCOL || typeof auth.publicKey !== 'string' || typeof auth.id !== 'string' || publicKeyId(auth.publicKey) !== auth.id || typeof auth.displayName !== 'string' || typeof auth.listenPort !== 'number' || !Number.isInteger(auth.listenPort) || auth.listenPort < 1 || auth.listenPort > 65535 || !verifySigned(auth.publicKey, `relay-client-v1|${challenge}|${this.certificateHash}`, auth.signature)) throw new Error('Relay identity authentication failed.');
      const peer = this.rememberPeer({ id: auth.id, displayName: validateDisplayName(auth.displayName), fingerprint: fingerprint(auth.publicKey), publicKey: auth.publicKey, address: socket.remoteAddress?.replace(/^::ffff:/, '') ?? '', port: Number(auth.listenPort) || 0, lastSeenAt: new Date().toISOString(), verified: false, identityChanged: false });
      await socketWrite(socket, { type: 'authenticated' });
      const command = await reader.next();
      if (command.type === 'message') await this.receiveMessage(peer, command, socket);
      else if (command.type === 'file-offer') await this.receiveFile(peer, command, reader, socket);
      else throw new Error('Relay command is unsupported.');
    } catch (error) { try { await socketWrite(socket, { type: 'error', message: error instanceof Error ? error.message : 'Relay request failed.' }); } catch { /* connection failed */ } socket.destroy(); }
  }
  private async connect(peer: StoredPeer): Promise<{ socket: tls.TLSSocket; reader: FrameReader }> {
    if (!this.server || !this.listenPort) throw new Error('Start Local Relay before contacting another Outpost.');
    const socket = tls.connect({ host: peer.address, port: peer.port, rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', servername: 'Outpost Zero Local Relay' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('The peer could not be reached. The host firewall may be blocking Local Relay.')); }, 10_000);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve(); }); socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const reader = new FrameReader(socket); const hello = await reader.next();
    const certificate = socket.getPeerCertificate(true); const certificateHash = certificate.raw ? crypto.createHash('sha256').update(certificate.raw).digest('hex').toUpperCase() : '';
    if (hello.type !== 'server-hello' || hello.protocol !== PROTOCOL || typeof hello.publicKey !== 'string' || typeof hello.id !== 'string' || hello.id !== peer.id || publicKeyId(hello.publicKey) !== hello.id || typeof hello.challenge !== 'string' || hello.certificateHash !== certificateHash || !verifySigned(hello.publicKey, `relay-server-v1|${hello.challenge}|${certificateHash}`, hello.signature)) { socket.destroy(); throw new Error('The peer identity or secure channel could not be verified.'); }
    const own = this.identity(); await socketWrite(socket, { type: 'client-auth', protocol: PROTOCOL, id: own.id, displayName: own.profile.displayName, publicKey: own.publicKey, listenPort: this.listenPort, signature: this.profile.sign(Buffer.from(`relay-client-v1|${hello.challenge}|${certificateHash}`)) });
    const authenticated = await reader.next(); if (authenticated.type !== 'authenticated') { socket.destroy(); throw new Error('The peer rejected identity authentication.'); }
    peer.lastSeenAt = new Date().toISOString(); this.persist(); return { socket, reader };
  }

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
    if (scope === 'room') {
      const peers = this.stored.peers.filter((peer) => this.publicPeer(peer).online); if (!peers.length) return this.result(false, 'No nearby Outposts are online.');
      const id = crypto.randomUUID(); const sentAt = new Date().toISOString(); const outcomes = await Promise.allSettled(peers.map((peer) => this.sendMessageFrame(peer, id, 'room', text, sentAt)));
      const delivered = outcomes.filter((item) => item.status === 'fulfilled').length; this.addMessage({ id, peerId: 'room', scope: 'room', direction: 'outgoing', senderName: this.identity().profile.displayName, body: text, sentAt, delivered: delivered > 0, read: true });
      return this.result(delivered > 0, `Room message delivered to ${delivered} of ${peers.length} nearby Outposts.`);
    }
    const peer = this.stored.peers.find((item) => item.id === peerId); if (!peer) return this.result(false, 'That peer is no longer known.');
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
