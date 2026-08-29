import fs from 'node:fs';
import path from 'node:path';
import { ReadlineParser, SerialPort } from 'serialport';
import type { DatabaseService } from './database-service';
import type { PortablePathService } from './portable-path';
import type {
  ModuleSummary, RemoteIdContact, RemoteIdObservation, RemoteIdPort, RemoteIdReceiverInfo, RemoteIdSerialLine, RemoteIdState,
} from '../shared/contracts';
import { Esp32S3RemoteIdAdapter, type RemoteIdReceiverAdapter, type RemoteIdReceiverMessage } from './remote-id-receiver';
export { Esp32S3RemoteIdAdapter } from './remote-id-receiver';

const MODULE_ID = 'remote-id-radar';
const MODULE_VERSION = '1.0.0';
const MAX_TRACK_POINTS = 1_800;
const BACKGROUND_EMIT_MS = 1_000;
const MAX_SERIAL_LOG_LINES = 250;
const MAX_SERIAL_LOG_LINE_CHARS = 4_096;

type StateListener = (state: RemoteIdState) => void;

const defaultAdapter = new Esp32S3RemoteIdAdapter();
export function parseRemoteIdLine(line: string): RemoteIdReceiverMessage { return defaultAdapter.consumeLine(line); }

export class RemoteIdContactTracker {
  private readonly contacts = new Map<string, RemoteIdContact>();

  update(observation: RemoteIdObservation): RemoteIdContact {
    const previous = this.contacts.get(observation.sourceKey);
    if (previous && observation.sequence !== undefined && previous.lastSequence !== undefined && observation.sequence < previous.lastSequence) return previous;
    const nextAircraft = { ...(previous?.aircraft ?? {}), ...Object.fromEntries(Object.entries(observation.aircraft).filter(([, item]) => item !== undefined)) };
    const track = [...(previous?.track ?? [])];
    if (observation.aircraft.latitude !== undefined && observation.aircraft.longitude !== undefined) {
      const latest = track.at(-1);
      if (!latest || latest.latitude !== observation.aircraft.latitude || latest.longitude !== observation.aircraft.longitude) {
        track.push({ latitude: observation.aircraft.latitude, longitude: observation.aircraft.longitude, receivedAt: observation.receivedAt });
        if (track.length > MAX_TRACK_POINTS) track.splice(0, track.length - MAX_TRACK_POINTS);
      }
    }
    const contact: RemoteIdContact = {
      sourceKey: observation.sourceKey, firstSeenAt: previous?.firstSeenAt ?? observation.receivedAt, lastSeenAt: observation.receivedAt,
      lastSequence: observation.sequence ?? previous?.lastSequence, source: { ...(previous?.source ?? { transport: 'unknown' }), ...observation.source },
      aircraft: nextAircraft, secondaryPosition: observation.secondaryPosition ?? previous?.secondaryPosition,
      operatorId: observation.operatorId ?? previous?.operatorId, selfId: observation.selfId ?? previous?.selfId, track,
    };
    this.contacts.set(observation.sourceKey, contact);
    return contact;
  }

  values(now = Date.now()): RemoteIdContact[] {
    for (const [key, contact] of this.contacts) if (now - Date.parse(contact.lastSeenAt) > 60_000) this.contacts.delete(key);
    return [...this.contacts.values()].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  }

  clear(): void { this.contacts.clear(); }
}

export class RemoteIdService {
  private moduleInstalled = false;
  private enabled = false;
  private connection: RemoteIdState['connection'] = 'disconnected';
  private port?: SerialPort;
  private selectedPort?: string;
  private receiver?: RemoteIdReceiverInfo;
  private lastHeartbeatAt?: string;
  private lastSerialLineAt?: string;
  private lastError?: string;
  private prioritySourceKey?: string;
  private serialLinesReceived = 0;
  private ignoredLinesReceived = 0;
  private observationsReceived = 0;
  private readonly serialLog: RemoteIdSerialLine[] = [];
  private readonly tracker = new RemoteIdContactTracker();
  private emitTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;

  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService, private readonly listener: StateListener,
    private readonly receiverAdapter: RemoteIdReceiverAdapter = new Esp32S3RemoteIdAdapter()) {
    try { this.moduleInstalled = this.database.moduleRecords().some((record) => record.moduleId === MODULE_ID); }
    catch { this.moduleInstalled = false; }
  }

  // Never touch the portable SQLite file from the serial/timer state path. A USB
  // drive can briefly reject I/O while Windows is flushing or power-managing it;
  // allowing that synchronous exception out of a timer crashes Electron's main
  // process. Installation changes are explicit, so an in-memory value is enough.
  private installed(): boolean { return this.moduleInstalled; }
  summary(): ModuleSummary {
    const installed = this.installed();
    return { id: MODULE_ID, name: 'Remote ID Radar', description: 'Requires a separate ESP32-S3 Remote ID receiver connected by USB. Outpost Zero cannot detect drones without this external hardware.',
      status: this.enabled && installed ? 'running' : installed ? 'installed' : 'available', optional: true,
      version: installed ? MODULE_VERSION : undefined, health: this.enabled ? (this.connection === 'error' ? 'unhealthy' : 'healthy') : 'stopped',
      logPath: this.paths.resolve('Logs/Modules/remote-id-radar.log') };
  }

  state(): RemoteIdState {
    return { installed: this.installed(), enabled: this.enabled, connection: this.connection, selectedPort: this.selectedPort,
      receiver: this.receiver, lastHeartbeatAt: this.lastHeartbeatAt, lastSerialLineAt: this.lastSerialLineAt,
      lastError: this.lastError, prioritySourceKey: this.prioritySourceKey,
      serialLinesReceived: this.serialLinesReceived, ignoredLinesReceived: this.ignoredLinesReceived, observationsReceived: this.observationsReceived,
      serialLog: this.serialLog.map((entry) => ({ ...entry })),
      contacts: this.tracker.values() };
  }

  private log(message: string): void {
    try { fs.appendFileSync(this.paths.resolve('Logs/Modules/remote-id-radar.log'), `${new Date().toISOString()} ${message}\n`, 'utf8'); }
    catch { /* Diagnostics must never terminate live receiver processing. */ }
  }

  private emit(immediate = false): void {
    if (immediate) { if (this.emitTimer) clearTimeout(this.emitTimer); this.emitTimer = undefined; this.listener(this.state()); return; }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = undefined; this.listener(this.state()); }, BACKGROUND_EMIT_MS);
  }

  async ports(): Promise<RemoteIdPort[]> {
    if (!this.installed()) return [];
    return (await SerialPort.list()).map((item) => ({ path: item.path, manufacturer: item.manufacturer, serialNumber: item.serialNumber, vendorId: item.vendorId, productId: item.productId }));
  }

  async install(): Promise<{ ok: boolean; message: string }> {
    this.database.setModuleInstalled(MODULE_ID, MODULE_VERSION); this.moduleInstalled = true; this.lastError = undefined;
    this.log('Remote ID Radar installed; receiver remains disabled.'); this.emit(true);
    return { ok: true, message: 'Remote ID Radar installed. It remains off until you select START.' };
  }
  repair(): Promise<{ ok: boolean; message: string }> { return this.install(); }
  async start(): Promise<{ ok: boolean; message: string }> {
    if (!this.installed()) return { ok: false, message: 'Install Remote ID Radar first.' };
    this.enabled = true; this.lastError = undefined; this.log('Remote ID Radar enabled.'); this.emit(true);
    return { ok: true, message: 'Remote ID Radar is enabled. Open Maps > Radar to connect the receiver.' };
  }
  async stop(): Promise<{ ok: boolean; message: string }> {
    await this.disconnect(); this.enabled = false; this.prioritySourceKey = undefined; this.log('Remote ID Radar disabled.'); this.emit(true);
    return { ok: true, message: 'Remote ID Radar is stopped.' };
  }
  async uninstall(): Promise<{ ok: boolean; message: string }> {
    await this.stop(); this.database.removeModule(MODULE_ID); this.moduleInstalled = false; this.tracker.clear(); this.receiver = undefined; this.lastError = undefined; this.emit(true);
    return { ok: true, message: 'Remote ID Radar engine removed. Logs were kept on this drive.' };
  }

  async connect(portPath: string, baudRate = 115_200): Promise<RemoteIdState> {
    if (!this.installed() || !this.enabled) throw new Error('Remote ID Radar must be installed and started first.');
    if (!/^COM\d{1,3}$/i.test(portPath) || !Number.isInteger(baudRate) || baudRate < 1_200 || baudRate > 3_000_000) throw new Error('Remote ID serial connection settings are invalid.');
    await this.disconnect(); this.connection = 'connecting'; this.selectedPort = portPath.toUpperCase(); this.lastError = undefined;
    this.lastSerialLineAt = undefined; this.serialLinesReceived = 0; this.ignoredLinesReceived = 0; this.observationsReceived = 0; this.serialLog.length = 0; this.emit(true);
    const port = new SerialPort({ path: this.selectedPort, baudRate, autoOpen: false }); this.port = port;
    try { await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve())); }
    catch (error) {
      this.port = undefined; this.connection = 'error'; this.lastError = error instanceof Error ? error.message : 'The serial port could not be opened.';
      this.log(`Connection failed on ${this.selectedPort}: ${this.lastError}`); this.emit(true); throw error;
    }
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n', encoding: 'utf8', includeDelimiter: false }));
    parser.on('data', (line: string) => this.ingestReceiverLine(line));
    port.on('error', (error) => { this.lastError = error.message; this.connection = 'error'; this.log(`Serial error: ${error.message}`); this.emit(true); });
    port.on('close', () => {
      if (this.staleTimer) clearInterval(this.staleTimer); this.staleTimer = undefined;
      this.port = undefined;
      if (this.connection !== 'disconnected' && this.connection !== 'error') { this.connection = 'disconnected'; this.emit(true); }
    });
    this.staleTimer = setInterval(() => this.emit(true), 5_000); this.staleTimer.unref();
    this.connection = 'connected'; this.log(`Connected to ${this.selectedPort} at ${baudRate} baud.`); this.emit(true); return this.state();
  }

  ingestReceiverLine(line: string): void {
    if (!line.trim()) return;
    this.serialLinesReceived += 1; this.lastSerialLineAt = new Date().toISOString();
    const displayLine = line.replaceAll('\0', '');
    const serialEntry: RemoteIdSerialLine = {
      receivedAt: this.lastSerialLineAt,
      line: displayLine.slice(0, MAX_SERIAL_LOG_LINE_CHARS),
      kind: 'debug',
      truncated: displayLine.length > MAX_SERIAL_LOG_LINE_CHARS || undefined,
    };
    this.serialLog.push(serialEntry);
    if (this.serialLog.length > MAX_SERIAL_LOG_LINES) this.serialLog.splice(0, this.serialLog.length - MAX_SERIAL_LOG_LINES);
    try {
      const message = this.receiverAdapter.consumeLine(line);
      if (message.type === 'ignored') { this.ignoredLinesReceived += 1; this.emit(); return; }
      if (message.type === 'scanner_ready') {
        serialEntry.kind = 'receiver';
        this.receiver = message.receiver; this.connection = 'scanner-ready'; this.lastHeartbeatAt = new Date().toISOString(); this.lastError = undefined;
        this.log('ESP32 scanner reported ready.'); this.emit(true);
      }
      else if (message.type === 'hello') { serialEntry.kind = 'receiver'; this.receiver = message.receiver; this.lastHeartbeatAt = new Date().toISOString(); this.lastError = undefined; this.emit(true); }
      else if (message.type === 'heartbeat') { serialEntry.kind = 'receiver'; this.lastHeartbeatAt = new Date().toISOString(); this.emit(); }
      else if (message.type === 'receiver_error') { serialEntry.kind = 'error'; this.lastError = message.message; this.log(`Receiver error: ${message.message}`); this.emit(true); }
      else {
        serialEntry.kind = 'aircraft';
        this.lastError = undefined; this.observationsReceived += 1;
        if (this.connection === 'connected') {
          this.connection = 'scanner-ready';
          this.receiver ??= { name: 'ESP32-S3 Remote ID Receiver', firmwareVersion: 'unknown', transports: [], priorityControl: false };
        }
        const contact = this.tracker.update(message.observation); this.emit(contact.sourceKey === this.prioritySourceKey);
      }
    } catch (error) { serialEntry.kind = 'error'; this.lastError = error instanceof Error ? error.message : 'Remote ID message could not be read.'; this.log(this.lastError); this.emit(); }
  }

  async disconnect(): Promise<RemoteIdState> {
    if (this.staleTimer) clearInterval(this.staleTimer); this.staleTimer = undefined;
    const port = this.port; this.port = undefined;
    if (port?.isOpen) await new Promise<void>((resolve) => port.close(() => resolve()));
    this.connection = 'disconnected'; this.receiver = undefined; this.lastHeartbeatAt = undefined; this.emit(true); return this.state();
  }

  setPriority(sourceKey?: string): RemoteIdState {
    if (sourceKey && !this.tracker.values().some((contact) => contact.sourceKey === sourceKey)) throw new Error('That Remote ID contact is no longer available.');
    this.prioritySourceKey = sourceKey;
    if (this.port?.isOpen && this.receiver?.priorityControl) this.port.write(`${JSON.stringify({ schema: 'outpost.remote-id.command.v1', type: 'set_priority', sourceKey: sourceKey ?? null, backgroundIntervalMs: BACKGROUND_EMIT_MS })}\n`);
    this.emit(true); return this.state();
  }

  clearContacts(): RemoteIdState { this.tracker.clear(); this.prioritySourceKey = undefined; this.emit(true); return this.state(); }
  hasActiveConnection(): boolean { return this.enabled || Boolean(this.port?.isOpen); }
  shutdown(): Promise<void> { return this.stop().then(() => undefined); }
}
