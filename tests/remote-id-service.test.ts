import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { Esp32S3RemoteIdAdapter, parseRemoteIdLine, RemoteIdContactTracker, RemoteIdService } from '../src/main/remote-id-service';

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-remote-id-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root); paths.initializeLayout(); const database = new DatabaseService(paths);
  return { root, paths, database };
}

function observation(sequence = 1, latitude = 39.76) {
  return JSON.stringify({ schema: 'outpost.remote-id.v1', type: 'observation', sequence, sourceKey: 'ble-AABBCC', source: { transport: 'ble5', address: 'AABBCC', rssiDbm: -61 }, aircraft: { id: 'RID-TEST-001', latitude, longitude: -94.84, altitudeMslM: 152.4, horizontalSpeedMps: 11.2, headingDeg: 183 }, secondaryPosition: { kind: 'control-station', latitude: 39.75, longitude: -94.85 } });
}

test('Remote ID parser validates and normalizes receiver observations', () => {
  const parsed = parseRemoteIdLine(observation());
  assert.equal(parsed.type, 'observation');
  if (parsed.type !== 'observation') return;
  assert.equal(parsed.observation.source.transport, 'ble5');
  assert.equal(parsed.observation.source.rssiDbm, -61);
  assert.equal(parsed.observation.aircraft.id, 'RID-TEST-001');
  assert.equal(parsed.observation.secondaryPosition?.kind, 'control-station');
  assert.equal(parseRemoteIdLine('{broken').type, 'ignored');
  assert.equal(parseRemoteIdLine(JSON.stringify({ schema: 'other', type: 'heartbeat' })).type, 'ignored');
  assert.throws(() => parseRemoteIdLine(JSON.stringify({ schema: 'outpost.remote-id.v1', type: 'observation', source: {}, aircraft: { latitude: 20 } })), /stable source key|incomplete aircraft position/);
});

test('ESP32 adapter ignores ESP-IDF logs, recognizes scanner readiness, and translates aircraft JSON', () => {
  const adapter = new Esp32S3RemoteIdAdapter();
  assert.equal(adapter.consumeLine('I (518) wifi:mode : sta (7c:df:a1:00:00:00)').type, 'ignored');
  const ready = adapter.consumeLine('{"type":"boot","msg":"==== SCANNER READY - WiFi + BLE scanning active ===="}');
  assert.equal(ready.type, 'scanner_ready');
  const parsed = adapter.consumeLine(JSON.stringify({
    type: 'drone', protocol: 'WiFi', mac: 'AA:BB:CC:DD:EE:FF', rssi: -57, seq: 9,
    serial_number: 'RID-ESP32-001', lat: 39.7681, lon: -94.8466, altitude: 131.2,
    speed: 12.6, heading: 184.5, operator_id: 'OPERATOR-1',
    control_station: { lat: 39.7712, lon: -94.851 },
  }));
  assert.equal(parsed.type, 'observation');
  if (parsed.type !== 'observation') return;
  assert.equal(parsed.observation.sourceKey, 'RID-ESP32-001');
  assert.equal(parsed.observation.source.transport, 'wifi-beacon');
  assert.equal(parsed.observation.source.rssiDbm, -57);
  assert.equal(parsed.observation.aircraft.latitude, 39.7681);
  assert.equal(parsed.observation.secondaryPosition?.kind, 'control-station');
  assert.equal(parsed.observation.operatorId, 'OPERATOR-1');
  assert.throws(() => adapter.consumeLine(JSON.stringify({ type: 'drone', serial: 'BAD', lat: 39 })), /incomplete aircraft position/);
});

test('Remote ID tracker merges partial data, retains a bounded path, and rejects old sequences', () => {
  const tracker = new RemoteIdContactTracker();
  const first = parseRemoteIdLine(observation()); if (first.type !== 'observation') throw new Error('fixture'); tracker.update(first.observation);
  const second = parseRemoteIdLine(observation(2, 39.77)); if (second.type !== 'observation') throw new Error('fixture'); const current = tracker.update(second.observation);
  assert.equal(current.track.length, 2); assert.equal(current.aircraft.latitude, 39.77); assert.equal(current.aircraft.altitudeMslM, 152.4);
  const old = parseRemoteIdLine(observation(1, 10)); if (old.type !== 'observation') throw new Error('fixture'); assert.equal(tracker.update(old.observation).aircraft.latitude, 39.77);
});

test('Remote ID module installs stopped, starts explicitly, and uninstalls without deleting logs', async () => {
  const app = runtime(); const updates: number[] = []; const service = new RemoteIdService(app.database, app.paths, (state) => updates.push(state.contacts.length));
  try {
    assert.equal(service.summary().status, 'available');
    assert.equal((await service.install()).ok, true); assert.equal(service.summary().status, 'installed'); assert.equal(service.state().enabled, false);
    assert.equal((await service.start()).ok, true); assert.equal(service.summary().status, 'running');
    assert.equal((await service.stop()).ok, true); assert.equal(service.summary().status, 'installed');
    assert.equal((await service.uninstall()).ok, true); assert.equal(service.summary().status, 'available');
    assert.equal(fs.existsSync(app.paths.resolve('Logs/Modules/remote-id-radar.log')), true); assert.ok(updates.length >= 4);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('Remote ID service sends ESP32 lines through the existing tracker pipeline', async () => {
  const app = runtime(); const service = new RemoteIdService(app.database, app.paths, () => undefined);
  try {
    await service.install(); await service.start();
    service.ingestReceiverLine('I (518) wifi: WiFi driver task started');
    assert.equal(service.state().lastError, undefined);
    service.ingestReceiverLine('{"type":"boot","msg":"==== SCANNER READY - WiFi + BLE scanning active ===="}');
    assert.equal(service.state().connection, 'scanner-ready');
    service.ingestReceiverLine(JSON.stringify({ type: 'aircraft', transport: 'BLE5', mac: 'AABBCC', serial: 'RID-LIVE-1', lat: 39.76, lon: -94.84, rssi: -63 }));
    const [contact] = service.state().contacts;
    assert.equal(contact.sourceKey, 'RID-LIVE-1');
    assert.equal(contact.source.transport, 'ble5');
    assert.equal(contact.track.length, 1);
  } finally { await service.stop(); app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('map workspace keeps Remote ID Radar isolated in a dedicated tab', () => {
  const maps = fs.readFileSync('src/renderer/MapsView.tsx', 'utf8');
  const radar = fs.readFileSync('src/renderer/RemoteIdRadarView.tsx', 'utf8');
  const service = fs.readFileSync('src/main/remote-id-service.ts', 'utf8');
  assert.match(maps, /MAP VIEW[\s\S]*RADAR[\s\S]*MAP PACKAGES/);
  assert.match(maps, /mapSection === 'radar'.*<RemoteIdRadarView/);
  assert.match(radar, /const mapRef = useRef<MapLibreMap/);
  assert.match(radar, /EXTERNAL HARDWARE REQUIRED/);
  assert.match(radar, /scanner-ready/);
  assert.match(radar, /cannot detect drones by itself/i);
  assert.match(service, /Requires a separate ESP32-S3 Remote ID receiver connected by USB/);
  assert.match(radar, /MAKE PRIORITY CONTACT/);
  assert.match(radar, /cannot make a drone broadcast faster/i);
});

test('receiver guide ships inside the updater-owned resources boundary', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { build: { extraFiles: Array<{ from: string; to: string }> } };
  const guide = manifest.build.extraFiles.find((entry) => entry.from === 'portable/REMOTE_ID_RECEIVER.txt');
  assert.equal(guide?.to, 'resources/REMOTE_ID_RECEIVER.txt');
});
