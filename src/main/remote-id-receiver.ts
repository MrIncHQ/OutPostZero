import type { RemoteIdObservation, RemoteIdReceiverInfo } from '../shared/contracts';

const MAX_LINE_BYTES = 32 * 1024;

export type RemoteIdReceiverMessage =
  | { type: 'ignored' }
  | { type: 'scanner_ready'; receiver: RemoteIdReceiverInfo }
  | { type: 'hello'; receiver: RemoteIdReceiverInfo }
  | { type: 'heartbeat' }
  | { type: 'receiver_error'; message: string }
  | { type: 'observation'; observation: RemoteIdObservation };

export interface RemoteIdReceiverAdapter {
  readonly id: string;
  consumeLine(line: string): RemoteIdReceiverMessage;
}

type SecondaryPosition = NonNullable<RemoteIdObservation['secondaryPosition']>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function first(source: Record<string, unknown> | undefined, names: string[]): unknown {
  for (const name of names) if (source?.[name] !== undefined && source[name] !== null) return source[name];
  return undefined;
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) { const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  return undefined;
}

function bounded(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= minimum && number <= maximum ? number : undefined;
}

function shortText(value: unknown, maximum = 160): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function transport(value: unknown): RemoteIdObservation['source']['transport'] {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll('_', '-');
  if (normalized.includes('nan')) return 'wifi-nan';
  if (normalized.includes('wifi')) return 'wifi-beacon';
  if (normalized.includes('ble5') || normalized.includes('ble-5') || normalized.includes('long')) return 'ble5';
  if (normalized.includes('ble') || normalized.includes('bluetooth')) return 'ble4';
  return 'unknown';
}

function position(value: Record<string, unknown> | undefined, kind: SecondaryPosition['kind']): RemoteIdObservation['secondaryPosition'] | undefined {
  const latitude = bounded(first(value, ['latitude', 'lat']), -90, 90);
  const longitude = bounded(first(value, ['longitude', 'lon', 'lng']), -180, 180);
  if (latitude === undefined && longitude === undefined) return undefined;
  if (latitude === undefined || longitude === undefined) throw new Error('Remote ID observation contains an incomplete secondary position.');
  return { kind, latitude, longitude, altitudeM: finite(first(value, ['altitudeM', 'altitude_m', 'altitude', 'alt'])) };
}

export function parseOutpostRemoteIdMessage(value: Record<string, unknown>): Exclude<RemoteIdReceiverMessage, { type: 'ignored' | 'scanner_ready' }> {
  if (value.schema !== 'outpost.remote-id.v1') throw new Error('Remote ID receiver uses an unsupported protocol version.');
  if (value.type === 'heartbeat') return { type: 'heartbeat' };
  if (value.type === 'receiver_error') return { type: 'receiver_error', message: shortText(value.message, 300) ?? 'Receiver reported an error.' };
  if (value.type === 'hello') {
    const receiver = record(value.receiver);
    if (!receiver) throw new Error('Remote ID hello message is missing receiver information.');
    return { type: 'hello', receiver: {
      name: shortText(receiver.name, 80) ?? 'ESP32-S3 Remote ID Receiver',
      firmwareVersion: shortText(receiver.firmwareVersion, 40) ?? 'unknown',
      receiverId: shortText(receiver.receiverId, 80),
      transports: Array.isArray(receiver.transports) ? receiver.transports.map(transport).filter((item, index, all) => all.indexOf(item) === index) : [],
      priorityControl: receiver.priorityControl === true,
    } };
  }
  if (value.type !== 'observation') throw new Error('Remote ID receiver sent an unknown message type.');
  const source = record(value.source);
  const aircraft = record(value.aircraft);
  if (!source || !aircraft) throw new Error('Remote ID observation is missing source or aircraft data.');
  return normalizedObservation(value, source, aircraft);
}

function normalizedObservation(value: Record<string, unknown>, source: Record<string, unknown>, aircraft: Record<string, unknown>): { type: 'observation'; observation: RemoteIdObservation } {
  const address = shortText(first(source, ['address', 'mac', 'bssid']), 80);
  const aircraftId = shortText(first(aircraft, ['id', 'uasId', 'uas_id', 'serialNumber', 'serial_number', 'serial', 'basicId', 'basic_id']), 120);
  const sourceKey = shortText(first(value, ['sourceKey', 'source_key']), 120) ?? aircraftId ?? address;
  if (!sourceKey) throw new Error('Remote ID observation has no stable source key.');
  const latitude = bounded(first(aircraft, ['latitude', 'lat']), -90, 90);
  const longitude = bounded(first(aircraft, ['longitude', 'lon', 'lng']), -180, 180);
  if ((latitude === undefined) !== (longitude === undefined)) throw new Error('Remote ID observation contains an incomplete aircraft position.');
  const suppliedSecondary = record(first(value, ['secondaryPosition', 'secondary_position']));
  const controlStation = record(first(value, ['controlStation', 'control_station', 'operatorLocation', 'operator_location']));
  const takeoff = record(first(value, ['takeoffLocation', 'takeoff_location']));
  const secondaryPosition = suppliedSecondary
    ? position(suppliedSecondary, ['control-station', 'takeoff', 'operator', 'unknown'].includes(String(suppliedSecondary.kind)) ? suppliedSecondary.kind as SecondaryPosition['kind'] : 'unknown')
    : position(controlStation, 'control-station') ?? position(takeoff, 'takeoff');
  return { type: 'observation', observation: {
    sourceKey,
    sequence: bounded(first(value, ['sequence', 'seq']), 0, Number.MAX_SAFE_INTEGER),
    receivedAt: new Date().toISOString(),
    source: {
      transport: transport(first(source, ['transport', 'protocol', 'radio', 'source'])), address,
      rssiDbm: bounded(first(source, ['rssiDbm', 'rssi_dbm', 'rssi']), -140, 20),
      channel: bounded(first(source, ['channel', 'chan']), 0, 255),
    },
    aircraft: {
      id: aircraftId,
      idType: shortText(first(aircraft, ['idType', 'id_type']), 40),
      aircraftType: shortText(first(aircraft, ['aircraftType', 'aircraft_type', 'uaType', 'ua_type']), 60),
      latitude, longitude,
      altitudeMslM: finite(first(aircraft, ['altitudeMslM', 'altitude_msl_m', 'altitudeMsl', 'altitude_msl', 'altitude', 'alt'])),
      heightAglM: finite(first(aircraft, ['heightAglM', 'height_agl_m', 'heightAgl', 'height_agl', 'height'])),
      horizontalSpeedMps: bounded(first(aircraft, ['horizontalSpeedMps', 'horizontal_speed_mps', 'speedMps', 'speed_mps', 'speed']), 0, 2_000),
      verticalSpeedMps: bounded(first(aircraft, ['verticalSpeedMps', 'vertical_speed_mps', 'verticalSpeed', 'vertical_speed', 'vspeed']), -500, 500),
      headingDeg: bounded(first(aircraft, ['headingDeg', 'heading_deg', 'heading', 'direction']), 0, 360),
      status: shortText(first(aircraft, ['status', 'operationalStatus', 'operational_status']), 60),
    },
    secondaryPosition,
    operatorId: shortText(first(value, ['operatorId', 'operator_id']), 120),
    selfId: shortText(first(value, ['selfId', 'self_id', 'description']), 200),
  } };
}

function looksLikeObservation(value: Record<string, unknown>): boolean {
  const type = String(value.type ?? value.messageType ?? value.message_type ?? '').toLowerCase();
  if (['observation', 'aircraft', 'drone', 'remote_id', 'remote-id', 'rid'].includes(type)) return true;
  const payload = record(value.aircraft) ?? record(value.drone) ?? record(value.data) ?? value;
  return first(payload, ['latitude', 'lat', 'longitude', 'lon', 'lng', 'uasId', 'uas_id', 'serialNumber', 'serial_number', 'basicId', 'basic_id']) !== undefined;
}

export class Esp32S3RemoteIdAdapter implements RemoteIdReceiverAdapter {
  readonly id = 'esp32-s3';

  consumeLine(line: string): RemoteIdReceiverMessage {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'ignored' };
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_LINE_BYTES) throw new Error('Remote ID serial message exceeded 32 KB.');
    // ESP-IDF startup and diagnostic output is expected on the same stream.
    if (!trimmed.startsWith('{')) return { type: 'ignored' };
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const object = record(parsed);
      if (!object) throw new Error('Remote ID receiver message must be an object.');
      value = object;
    } catch (error) {
      if (error instanceof SyntaxError) return { type: 'ignored' };
      throw error;
    }
    if (value.schema === 'outpost.remote-id.v1') return parseOutpostRemoteIdMessage(value);
    if (value.schema !== undefined) return { type: 'ignored' };
    if (value.type === 'boot') {
      const message = shortText(value.msg ?? value.message, 300) ?? '';
      if (/scanner\s+ready/i.test(message)) return { type: 'scanner_ready', receiver: {
        name: 'ESP32-S3 Remote ID Receiver', firmwareVersion: shortText(value.version, 40) ?? 'unknown',
        receiverId: shortText(value.receiverId ?? value.receiver_id, 80), transports: ['wifi-beacon', 'ble4', 'ble5'], priorityControl: false,
      } };
      return { type: 'ignored' };
    }
    if (value.type === 'heartbeat' || value.type === 'status' && String(value.status).toLowerCase() === 'ready') return { type: 'heartbeat' };
    if (value.type === 'error') return { type: 'receiver_error', message: shortText(value.msg ?? value.message, 300) ?? 'Receiver reported an error.' };
    if (!looksLikeObservation(value)) return { type: 'ignored' };
    const aircraft = record(value.aircraft) ?? record(value.drone) ?? record(value.data) ?? value;
    const source = record(value.source) ?? record(value.radio) ?? value;
    return normalizedObservation(value, source, aircraft);
  }
}
