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
  scannedAt: string | null;
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
  ocrStatus: 'not-run' | 'running' | 'complete' | 'error';
  ocrUpdatedAt: string | null;
  ocrError: string | null;
  indexedPages: number;
  tags: string[];
  collections: string[];
}

export interface OcrProgress {
  documentId: string;
  state: 'idle' | 'preparing' | 'recognizing' | 'complete' | 'error' | 'cancelled';
  currentPage: number;
  totalPages: number;
  percent: number;
  message: string;
}

export interface OcrOperationResult {
  ok: boolean;
  message: string;
  document: DocumentDetails;
  progress: OcrProgress;
}

export interface EducationLessonSummary {
  id: string;
  title: string;
  durationMinutes: number;
  completed: boolean;
}

export interface EducationLesson extends EducationLessonSummary {
  courseId: string;
  courseTitle: string;
  body: string;
  format: 'markdown' | 'text';
}

export interface EducationCourseSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  author: string;
  relativePath: string;
  lessonCount: number;
  completedLessons: number;
  progressPercent: number;
  lessons: EducationLessonSummary[];
}

export interface EducationState {
  courses: EducationCourseSummary[];
  completedLessons: number;
  totalLessons: number;
}

export interface EducationOperationResult {
  ok: boolean;
  message: string;
  state: EducationState;
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

export interface NoteAttachment {
  id: string;
  fileName: string;
  relativePath: string;
  size: number;
  createdAt: string;
  readerUrl: string;
}

export interface PortableNote {
  id: string;
  title: string;
  body: string;
  folder: string;
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  attachments: NoteAttachment[];
}

export interface NoteInput {
  id?: string;
  title: string;
  body: string;
  folder: string;
  pinned: boolean;
  favorite: boolean;
  tags: string[];
}

export interface NotesState {
  notes: PortableNote[];
  folders: string[];
  tags: string[];
}

export interface MapPackage {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  format: 'pmtiles' | 'mbtiles';
  size: number;
  addedAt: string;
  readerUrl: string;
  tileType?: 'raster' | 'vector' | 'unknown';
  sourceLayers?: string[];
  minZoom?: number;
  maxZoom?: number;
  bounds?: [number, number, number, number];
}

export interface MapPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  note: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MapPlaceInput {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  note: string;
  favorite: boolean;
}

export interface MapsState {
  packages: MapPackage[];
  places: MapPlace[];
}

export interface RemoteIdPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface RemoteIdReceiverInfo {
  name: string;
  firmwareVersion: string;
  receiverId?: string;
  transports: Array<'ble4' | 'ble5' | 'wifi-beacon' | 'wifi-nan' | 'unknown'>;
  priorityControl: boolean;
}

export interface RemoteIdObservation {
  sourceKey: string;
  sequence?: number;
  receivedAt: string;
  source: {
    transport: 'ble4' | 'ble5' | 'wifi-beacon' | 'wifi-nan' | 'unknown';
    address?: string;
    rssiDbm?: number;
    channel?: number;
  };
  aircraft: {
    id?: string;
    idType?: string;
    aircraftType?: string;
    latitude?: number;
    longitude?: number;
    altitudeMslM?: number;
    heightAglM?: number;
    horizontalSpeedMps?: number;
    verticalSpeedMps?: number;
    headingDeg?: number;
    status?: string;
  };
  secondaryPosition?: {
    kind: 'control-station' | 'takeoff' | 'operator' | 'unknown';
    latitude: number;
    longitude: number;
    altitudeM?: number;
  };
  operatorId?: string;
  selfId?: string;
}

export interface RemoteIdContact extends Omit<RemoteIdObservation, 'receivedAt' | 'sequence'> {
  firstSeenAt: string;
  lastSeenAt: string;
  lastSequence?: number;
  track: Array<{ latitude: number; longitude: number; receivedAt: string }>;
}

export interface RemoteIdState {
  installed: boolean;
  enabled: boolean;
  connection: 'disconnected' | 'connecting' | 'connected' | 'scanner-ready' | 'error';
  selectedPort?: string;
  receiver?: RemoteIdReceiverInfo;
  lastHeartbeatAt?: string;
  lastError?: string;
  prioritySourceKey?: string;
  contacts: RemoteIdContact[];
}

export interface MapDownloadRequest {
  title: string;
  latitude: number;
  longitude: number;
  radiusKilometers: number;
  maxZoom: 8 | 12 | 15;
}

export interface MapDownloadStatus {
  state: 'idle' | 'resolving' | 'downloading' | 'verifying' | 'complete' | 'cancelled' | 'error';
  title?: string;
  sourceDate?: string;
  percent: number;
  downloadedBytes: number;
  estimatedBytes: number;
  elapsedSeconds: number;
  message: string;
}

export interface MapLocationResult {
  id: string;
  displayName: string;
  latitude: number;
  longitude: number;
  bounds?: [number, number, number, number];
}

export interface PhaseFiveOperationResult<T> {
  ok: boolean;
  message: string;
  state: T;
}

export interface RelayPeer {
  id: string;
  displayName: string;
  fingerprint: string;
  address: string;
  port: number;
  lastSeenAt: string;
  online: boolean;
  verified: boolean;
  identityChanged: boolean;
  verificationCode: string;
}

export interface RelayMessage {
  id: string;
  peerId: string;
  scope: 'direct' | 'room';
  direction: 'incoming' | 'outgoing';
  senderName: string;
  body: string;
  sentAt: string;
  delivered: boolean;
  read: boolean;
}

export interface RelayTransfer {
  id: string;
  peerId: string;
  peerName: string;
  direction: 'incoming' | 'outgoing';
  fileName: string;
  size: number;
  sha256: string;
  status: 'offered' | 'waiting' | 'transferring' | 'complete' | 'declined' | 'cancelled' | 'error';
  transferredBytes: number;
  relativePath?: string;
  message?: string;
}

export interface RelayState {
  enabled: boolean;
  port: number | null;
  historyEnabled: boolean;
  identityFingerprint: string;
  transport: 'TLS 1.3';
  firewallMessage: string | null;
  peers: RelayPeer[];
  messages: RelayMessage[];
  transfers: RelayTransfer[];
}

export interface RelayOperationResult {
  ok: boolean;
  message: string;
  state: RelayState;
}

export interface UnifiedSearchResult {
  source: 'document' | 'note' | 'map' | 'media';
  id: string;
  title: string;
  excerpt: string;
  context: string;
  page?: number;
  latitude?: number;
  longitude?: number;
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
  gpuChecked: boolean;
}

export type AiTier = 'light' | 'balanced' | 'advanced' | 'expert';

export interface AiModelState {
  id: string;
  name: string;
  publisher: string;
  license: string;
  parameters: string;
  quantization: string;
  tier: AiTier;
  contextLength: number;
  downloadBytes: number;
  minimumMemoryBytes: number;
  recommendedMemoryBytes: number;
  minimumLogicalCores: number;
  installed: boolean;
  selected: boolean;
  recommended: boolean;
  compatible: boolean;
  compatibilityMessage: string;
}

export interface AiDownloadStatus {
  state: 'idle' | 'downloading-runtime' | 'downloading-model' | 'verifying' | 'installing' | 'complete' | 'cancelled' | 'error';
  itemId?: string;
  title?: string;
  downloadedBytes: number;
  totalBytes: number;
  message: string;
}

export interface AiState {
  supportedHost: boolean;
  hostMessage: string;
  runtimeInstalled: boolean;
  runtimeVersion: string;
  accelerationSupported: boolean;
  acceleratorInstalled: boolean;
  runtimeBackend: 'cpu' | 'vulkan';
  runtimeMessage: string;
  running: boolean;
  enabled: boolean;
  selectedModelId: string | null;
  recommendedModelId: string | null;
  models: AiModelState[];
  hardware: HardwareDiagnostics;
  download: AiDownloadStatus;
}

export interface AiOperationResult {
  ok: boolean;
  message: string;
  state: AiState;
}

export interface AiSource {
  id: string;
  kind: 'document' | 'kiwix';
  title: string;
  location: string;
  excerpt: string;
  documentId?: string;
  page?: number;
  articlePath?: string;
}

export interface AiChatResult extends AiOperationResult {
  response?: string;
  sources?: AiSource[];
}

export interface AiChatProgress {
  phase: 'idle' | 'searching' | 'generating' | 'complete' | 'error';
  response: string;
  sources: AiSource[];
  elapsedMs: number;
  generatedTokens?: number;
  tokensPerSecond?: number;
  searchSummary?: string;
  message: string;
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
  readyVersion: string | null;
}

export interface UpdateCheckResult {
  status: 'not-configured' | 'up-to-date' | 'available' | 'error';
  message: string;
  currentVersion: string;
  availableVersion?: string;
  downloadBytes?: number;
  readyToInstall?: boolean;
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
  database: { schemaVersion: number; integrityOk: boolean | null };
}

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  kind: MediaKind;
  size: number;
  addedAt: string;
  modifiedAt: string;
  favorite: boolean;
  tags: string[];
  collections: string[];
  playbackSeconds: number;
  durationSeconds: number | null;
  readerUrl: string;
}

export interface MediaState { items: MediaItem[]; scannedAt: string | null; }
export interface MediaOperationResult { ok: boolean; message: string; state: MediaState; }
export interface MediaMetadataUpdate {
  title?: string; favorite?: boolean; tags?: string[]; collections?: string[];
  playbackSeconds?: number; durationSeconds?: number;
}

export interface MedicationRecord {
  id: string;
  brandNames: string[];
  genericNames: string[];
  substances: string[];
  manufacturerNames: string[];
  productNdcs: string[];
  routes: string[];
  dosageForms: string[];
  indications: string;
  warnings: string;
  contraindications: string;
  dosageAndAdministration: string;
  adverseReactions: string;
  drugInteractions: string;
  storage: string;
  retrievedAt: string;
}

export interface PillRecord {
  id: string;
  setId: string;
  name: string;
  productNdc: string;
  imprint: string;
  color: string;
  shape: string;
  size: string;
  score: number | null;
  publishedDate: string;
  retrievedAt: string;
}

export interface PillSearchQuery {
  imprint: string;
  color?: string;
  shape?: string;
}

export interface PillMatch extends PillRecord {
  match: 'exact' | 'partial';
}

export interface MedicationState {
  disclaimerVersion: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  cachedRecords: number;
  cachedPills: number;
  starterPills: number;
  pillIndexRelease: string | null;
  lastOnlineRefreshAt: string | null;
  records: MedicationRecord[];
}

export interface MedicationOperationResult { ok: boolean; message: string; state: MedicationState; }
export interface MedicationSuggestion { value: string; label: string; detail: string; source: 'drive' | 'FDA'; }

export interface OutpostBridge {
  getBootstrap(): Promise<BootstrapData>;
  createProfile(displayName: string): Promise<LocalProfile>;
  updateProfile(displayName: string): Promise<LocalProfile>;
  refreshStorage(): Promise<StorageSummary>;
  refreshHardware(): Promise<HardwareDiagnostics>;
  getAiState(): Promise<AiState>;
  installAiRuntime(): Promise<AiOperationResult>;
  downloadAiModel(modelId: string): Promise<AiOperationResult>;
  getAiDownloadStatus(): Promise<AiDownloadStatus>;
  cancelAiDownload(): Promise<AiDownloadStatus>;
  selectAiModel(modelId: string | null): Promise<AiOperationResult>;
  removeAiModel(modelId: string): Promise<AiOperationResult>;
  startAi(): Promise<AiOperationResult>;
  stopAi(): Promise<AiOperationResult>;
  chatWithAi(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<AiChatResult>;
  getAiChatProgress(): Promise<AiChatProgress>;
  checkDatabaseIntegrity(): Promise<boolean>;
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
  runDocumentOcr(documentId: string): Promise<OcrOperationResult>;
  getDocumentOcrProgress(documentId: string): Promise<OcrProgress>;
  cancelDocumentOcr(documentId: string): Promise<OcrProgress>;
  getMedia(): Promise<MediaState>;
  importMedia(): Promise<MediaOperationResult>;
  scanMedia(): Promise<MediaOperationResult>;
  updateMediaMetadata(mediaId: string, update: MediaMetadataUpdate): Promise<MediaState>;
  removeMedia(mediaId: string): Promise<MediaOperationResult>;
  getMedicationState(query?: string): Promise<MedicationState>;
  getMedicationSuggestions(query: string): Promise<MedicationSuggestion[]>;
  acknowledgeMedicationDisclaimer(accepted: boolean): Promise<MedicationState>;
  fetchMedicationFromFda(query: string): Promise<MedicationOperationResult>;
  fetchPillRecordsFromFda(query: string): Promise<MedicationOperationResult>;
  searchPillRecords(query: PillSearchQuery): Promise<PillMatch[]>;
  removeMedicationCache(): Promise<MedicationOperationResult>;
  getEducation(): Promise<EducationState>;
  importEducationCourse(): Promise<EducationOperationResult>;
  addStarterCourse(): Promise<EducationOperationResult>;
  getEducationLesson(courseId: string, lessonId: string): Promise<EducationLesson>;
  setEducationLessonComplete(courseId: string, lessonId: string, completed: boolean): Promise<EducationState>;
  removeEducationCourse(courseId: string): Promise<EducationOperationResult>;
  getNotes(): Promise<NotesState>;
  saveNote(note: NoteInput): Promise<PortableNote>;
  deleteNote(noteId: string): Promise<NotesState>;
  importNoteAttachments(noteId: string): Promise<PortableNote>;
  removeNoteAttachment(noteId: string, attachmentId: string): Promise<PortableNote>;
  exportNote(noteId: string): Promise<{ ok: boolean; message: string }>;
  getMaps(): Promise<MapsState>;
  getMapTile(packageId: string, z: number, x: number, y: number): Promise<Uint8Array | null>;
  getMapGlyph(fontStack: string, range: string): Promise<Uint8Array | null>;
  importMapPackages(): Promise<PhaseFiveOperationResult<MapsState>>;
  searchMapLocations(query: string): Promise<MapLocationResult[]>;
  downloadMap(request: MapDownloadRequest): Promise<PhaseFiveOperationResult<MapsState>>;
  getMapDownloadStatus(): Promise<MapDownloadStatus>;
  cancelMapDownload(): Promise<MapDownloadStatus>;
  removeMapPackage(packageId: string): Promise<PhaseFiveOperationResult<MapsState>>;
  saveMapPlace(place: MapPlaceInput): Promise<MapPlace>;
  deleteMapPlace(placeId: string): Promise<MapsState>;
  importGpx(): Promise<PhaseFiveOperationResult<MapsState>>;
  exportGpx(): Promise<{ ok: boolean; message: string }>;
  getRemoteIdState(): Promise<RemoteIdState>;
  listRemoteIdPorts(): Promise<RemoteIdPort[]>;
  connectRemoteId(portPath: string, baudRate?: number): Promise<RemoteIdState>;
  disconnectRemoteId(): Promise<RemoteIdState>;
  setRemoteIdPriority(sourceKey?: string): Promise<RemoteIdState>;
  clearRemoteIdContacts(): Promise<RemoteIdState>;
  onRemoteIdUpdate(listener: (state: RemoteIdState) => void): () => void;
  getRelayState(): Promise<RelayState>;
  startRelay(): Promise<RelayOperationResult>;
  stopRelay(): Promise<RelayOperationResult>;
  setRelayHistory(enabled: boolean): Promise<RelayState>;
  verifyRelayPeer(peerId: string): Promise<RelayState>;
  forgetRelayPeer(peerId: string): Promise<RelayState>;
  sendRelayMessage(peerId: string, scope: 'direct' | 'room', body: string): Promise<RelayOperationResult>;
  markRelayRead(peerId: string, scope: 'direct' | 'room'): Promise<RelayState>;
  sendRelayFile(peerId: string): Promise<RelayOperationResult>;
  acceptRelayFile(transferId: string, destination: 'documents' | 'media' | 'custom'): Promise<RelayOperationResult>;
  declineRelayFile(transferId: string): Promise<RelayOperationResult>;
  cancelRelayTransfer(transferId: string): Promise<RelayOperationResult>;
  searchOutpost(query: string): Promise<UnifiedSearchResult[]>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<UpdateDownloadResult>;
  applyUpdate(): Promise<UpdateApplyResult>;
  prepareForRemoval(): Promise<{ ready: boolean; message: string }>;
}
