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
  status: 'available' | 'installed' | 'running' | 'error' | 'available-later';
  optional: boolean;
  version?: string;
  pid?: number;
  port?: number;
  startedAt?: string;
  health?: 'stopped' | 'healthy' | 'unhealthy';
  logPath?: string;
  testModule?: boolean;
}

export interface ModuleOperationResult {
  ok: boolean;
  message: string;
  modules: ModuleSummary[];
}

export interface ZimContentSummary {
  id: string;
  name: string;
  fileName: string;
  relativePath: string;
  size: number;
}

export interface OfflineLibraryStatus {
  engineInstalled: boolean;
  engineVersion: string | null;
  running: boolean;
  pid?: number;
  port?: number;
  serverUrl?: string;
  content: ZimContentSummary[];
}

export interface LibraryOperationResult {
  ok: boolean;
  message: string;
  status: OfflineLibraryStatus;
}

export interface KiwixCatalogEntry {
  id: string;
  title: string;
  summary: string;
  language: string;
  flavour: string;
  category: string;
  releaseDate: string;
  downloadBytes: number;
  fileName: string;
  installed: boolean;
}

export interface KiwixCatalogResult {
  ok: boolean;
  message: string;
  fetchedAt: string | null;
  entries: KiwixCatalogEntry[];
  freeBytes: number | null;
}

export interface KiwixDownloadStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'complete' | 'cancelled' | 'error';
  entryId?: string;
  title?: string;
  fileName?: string;
  downloadedBytes: number;
  totalBytes: number;
  message: string;
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
  refreshModules(): Promise<ModuleSummary[]>;
  installModule(moduleId: string): Promise<ModuleOperationResult>;
  startModule(moduleId: string): Promise<ModuleOperationResult>;
  stopModule(moduleId: string): Promise<ModuleOperationResult>;
  repairModule(moduleId: string): Promise<ModuleOperationResult>;
  uninstallModule(moduleId: string): Promise<ModuleOperationResult>;
  getLibraryStatus(): Promise<OfflineLibraryStatus>;
  scanLibrary(): Promise<OfflineLibraryStatus>;
  installKiwixSample(): Promise<LibraryOperationResult>;
  fetchKiwixCatalog(query: string, language: string): Promise<KiwixCatalogResult>;
  downloadKiwixContent(entryId: string): Promise<LibraryOperationResult>;
  getKiwixDownloadStatus(): Promise<KiwixDownloadStatus>;
  cancelKiwixDownload(): Promise<KiwixDownloadStatus>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateDownloadResult>;
  applyUpdate(): Promise<UpdateApplyResult>;
  prepareForRemoval(): Promise<{ ready: boolean; message: string }>;
}
