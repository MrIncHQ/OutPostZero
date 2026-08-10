import os from 'node:os';
import type { HardwareDiagnostics } from '../shared/contracts';

interface GpuDevice {
  active?: boolean;
  deviceString?: string;
  vendorId?: number;
  deviceId?: number;
}

function parseGpuDevices(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const devices = (raw as { gpuDevice?: unknown }).gpuDevice;
  if (!Array.isArray(devices)) return [];
  return devices
    .filter((device): device is GpuDevice => Boolean(device && typeof device === 'object'))
    .map((device) => device.deviceString?.trim() || `GPU ${device.vendorId ?? 'unknown'}:${device.deviceId ?? 'unknown'}`)
    .filter((name, index, names) => names.indexOf(name) === index);
}

export async function collectHardwareDiagnostics(gpuInfo: Promise<unknown>): Promise<HardwareDiagnostics> {
  const diagnostics = collectBasicHardwareDiagnostics();
  let gpuDevices: string[] = [];
  try {
    gpuDevices = parseGpuDevices(await gpuInfo);
  } catch {
    // GPU details can be unavailable under remote sessions or software rendering.
  }
  return { ...diagnostics, gpuDevices, gpuChecked: true };
}

export function collectBasicHardwareDiagnostics(): HardwareDiagnostics {
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model.trim() || 'Unknown CPU',
    logicalCores: cpus.length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    operatingSystem: `${os.type()} ${os.release()}`,
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
    gpuDevices: [],
    gpuChecked: false,
  };
}
