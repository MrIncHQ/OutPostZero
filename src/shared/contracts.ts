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

export interface BootstrapData {
  status: PortableStatus;
  profile: LocalProfile | null;
  storage: StorageSummary;
  modules: ModuleSummary[];
}

export interface OutpostBridge {
  getBootstrap(): Promise<BootstrapData>;
  createProfile(displayName: string): Promise<LocalProfile>;
  updateProfile(displayName: string): Promise<LocalProfile>;
  refreshStorage(): Promise<StorageSummary>;
  prepareForRemoval(): Promise<{ ready: boolean; message: string }>;
}
