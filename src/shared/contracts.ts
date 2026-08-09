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

export type DocumentFormat = 'pdf' | 'text' | 'markdown' | 'html' | 'image';
export type DocumentIndexStatus = 'not-indexed' | 'indexing' | 'indexed' | 'error';

export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  format: DocumentFormat;
  size: number;
  modifiedAt: string;
  addedAt: string;
  lastOpenedAt: string | null;
  currentPage: number;
  pageCount: number;
  favorite: boolean;
  indexStatus: DocumentIndexStatus;
  indexError: string | null;
  indexedPages: number;
  tags: string[];
  collections: string[];
}

export interface DocumentBookmark {
  id: string;
  page: number;
  label: string;
  createdAt: string;
}

export interface DocumentNote {
  id: string;
  page: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentAnnotation {
  id: string;
  page: number;
  kind: 'highlight' | 'comment';
  color: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetails extends DocumentSummary {
  readerUrl: string;
  bookmarks: DocumentBookmark[];
  notes: DocumentNote[];
  annotations: DocumentAnnotation[];
}

export interface DocumentLibraryState {
  documents: DocumentSummary[];
  collections: string[];
  tags: string[];
}

export interface DocumentSearchResult {
  documentId: string;
  title: string;
  format: DocumentFormat;
  page: number;
  excerpt: string;
  score: number;
}

export interface DocumentOperationResult {
  ok: boolean;
  message: string;
  library: DocumentLibraryState;
}

export interface DocumentMetadataUpdate {
  favorite?: boolean;
  currentPage?: number;
  tags?: string[];
  collections?: string[];
}

export interface DocumentNoteInput {
  id?: string;
  page: number;
  title: string;
  body: string;
}

export interface DocumentAnnotationInput {
  id?: string;
  page: number;
  kind: 'highlight' | 'comment';
  color: string;
  text: string;
}

export interface KiwixCatalogEntry {
  id: string;
  archiveName: string;
  title: string;
  summary: string;
  language: string;
  flavour: string;
  category: string;
  releaseDate: string;
  downloadBytes: number;
  fileName: string;
  installed: boolean;
  articleCount: number;
  mediaCount: number;
}

export interface KiwixCatalogOption {
  id: string;
  label: string;
  count: number;
}

export interface KiwixCatalogOptionsResult {
  ok: boolean;
  message: string;
  languages: KiwixCatalogOption[];
  categories: KiwixCatalogOption[];
}

export interface KiwixCatalogResult {
  ok: boolean;
  message: string;
  fetchedAt: string | null;
  entries: KiwixCatalogEntry[];
  freeBytes: number | null;
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
}

export interface KiwixDownloadStatus {
  state: 'idle' | 'downloading' | 'verifying' | 'complete' | 'cancelled' | 'error';
  entryId?: string;
  title?: string;
  fileName?: string;
  downloadedBytes: number;
  verifiedBytes?: number;
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
  removeKiwixContent(contentId: string): Promise<LibraryOperationResult>;
  installKiwixSample(): Promise<LibraryOperationResult>;
  getKiwixCatalogOptions(): Promise<KiwixCatalogOptionsResult>;
  fetchKiwixCatalog(query: string, language: string, category: string, startIndex: number): Promise<KiwixCatalogResult>;
  downloadKiwixContent(entryId: string): Promise<LibraryOperationResult>;
  getKiwixDownloadStatus(): Promise<KiwixDownloadStatus>;
  cancelKiwixDownload(): Promise<KiwixDownloadStatus>;
  getDocumentLibrary(): Promise<DocumentLibraryState>;
  importDocuments(): Promise<DocumentOperationResult>;
  scanDocuments(): Promise<DocumentOperationResult>;
  getDocument(documentId: string): Promise<DocumentDetails>;
  getDocumentText(documentId: string): Promise<string>;
  searchDocuments(query: string): Promise<DocumentSearchResult[]>;
  updateDocumentMetadata(documentId: string, update: DocumentMetadataUpdate): Promise<DocumentDetails>;
  removeDocument(documentId: string): Promise<DocumentOperationResult>;
  addDocumentBookmark(documentId: string, page: number, label: string): Promise<DocumentDetails>;
  removeDocumentBookmark(documentId: string, bookmarkId: string): Promise<DocumentDetails>;
  saveDocumentNote(documentId: string, note: DocumentNoteInput): Promise<DocumentDetails>;
  removeDocumentNote(documentId: string, noteId: string): Promise<DocumentDetails>;
  saveDocumentAnnotation(documentId: string, annotation: DocumentAnnotationInput): Promise<DocumentDetails>;
  removeDocumentAnnotation(documentId: string, annotationId: string): Promise<DocumentDetails>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateDownloadResult>;
  applyUpdate(): Promise<UpdateApplyResult>;
  prepareForRemoval(): Promise<{ ready: boolean; message: string }>;
}
