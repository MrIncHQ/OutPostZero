export interface PortableStatus {
  root: string;
  rootLabel: string;
  platform: NodeJS.Platform;
  architecture: string;
  version: string;
  freeBytes: number | null;
  totalBytes: number | null;
  recoveredFromUncleanShutdown: boolean;
  portablePaths: Record<string, string>;
}

export interface LocalProfile {
  displayName: string;
  createdAt: string;
  deviceFingerprint: string;
}

export interface StorageCategory {
  id: string;
  label: string;
  bytes: number;
}

export interface StorageSummary {
  categories: StorageCategory[];
  usedByOutpostBytes: number;
  freeBytes: number | null;
  totalBytes: number | null;
}

export interface ModuleSummary {
  id: string;
  name: string;
  description: string;
  status: 'foundation' | 'available-later';
  optional: boolean;
}

export interface HardwareDiagnostics {
  cpuModel: string;
  logicalCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  operatingSystem: string;
  platform: NodeJS.Platform;
  architecture: string;
  hostname: string;
  gpuDevices: string[];
}

export interface UpdateStatus {
  currentVersion: string;
  provider: 'none' | 'github';
  repositoryOwner: string | null;
  repositoryName: string | null;
  channel: 'stable' | 'preview';
  automaticChecks: boolean;
  lastCheckedAt: string | null;
  configured: boolean;
}

export interface UpdateCheckResult {
  status: 'not-configured' | 'up-to-date' | 'available' | 'error';
  message: string;
  currentVersion: string;
  availableVersion?: string;
  downloadBytes?: number;
}

export interface UpdateDownloadResult {
  status: 'ready' | 'no-update' | 'error';
  message: string;
  version?: string;
  changedFiles?: number;
  downloadedBytes?: number;
}

export interface UpdateApplyResult {
  status: 'launching' | 'not-ready' | 'error';
  message: string;
}

export interface BootstrapData {
  status: PortableStatus;
  profile: LocalProfile | null;
  storage: StorageSummary;
  modules: ModuleSummary[];
  hardware: HardwareDiagnostics;
  updates: UpdateStatus;
  database: { schemaVersion: number; integrityOk: boolean };
}

export interface OutpostBridge {
  getBootstrap(): Promise<BootstrapData>;
  createProfile(displayName: string): Promise<LocalProfile>;
  updateProfile(displayName: string): Promise<LocalProfile>;
  refreshStorage(): Promise<StorageSummary>;
  refreshHardware(): Promise<HardwareDiagnostics>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateDownloadResult>;
  applyUpdate(): Promise<UpdateApplyResult>;
  prepareForRemoval(): Promise<{ ready: boolean; message: string }>;
}
