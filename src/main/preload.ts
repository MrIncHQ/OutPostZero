import { contextBridge, ipcRenderer } from 'electron';
import type { OutpostBridge } from '../shared/contracts';

const bridge: OutpostBridge = {
  getBootstrap: () => ipcRenderer.invoke('outpost:get-bootstrap'),
  createProfile: (displayName) => ipcRenderer.invoke('outpost:create-profile', displayName),
  updateProfile: (displayName) => ipcRenderer.invoke('outpost:update-profile', displayName),
  refreshStorage: () => ipcRenderer.invoke('outpost:refresh-storage'),
  refreshHardware: () => ipcRenderer.invoke('outpost:refresh-hardware'),
  refreshModules: () => ipcRenderer.invoke('outpost:refresh-modules'),
  installModule: (moduleId) => ipcRenderer.invoke('outpost:install-module', moduleId),
  startModule: (moduleId) => ipcRenderer.invoke('outpost:start-module', moduleId),
  stopModule: (moduleId) => ipcRenderer.invoke('outpost:stop-module', moduleId),
  repairModule: (moduleId) => ipcRenderer.invoke('outpost:repair-module', moduleId),
  uninstallModule: (moduleId) => ipcRenderer.invoke('outpost:uninstall-module', moduleId),
  getLibraryStatus: () => ipcRenderer.invoke('outpost:get-library-status'),
  scanLibrary: () => ipcRenderer.invoke('outpost:scan-library'),
  installKiwixSample: () => ipcRenderer.invoke('outpost:install-kiwix-sample'),
  getKiwixCatalogOptions: () => ipcRenderer.invoke('outpost:get-kiwix-catalog-options'),
  fetchKiwixCatalog: (query, language, category, startIndex) => ipcRenderer.invoke('outpost:fetch-kiwix-catalog', query, language, category, startIndex),
  downloadKiwixContent: (entryId) => ipcRenderer.invoke('outpost:download-kiwix-content', entryId),
  getKiwixDownloadStatus: () => ipcRenderer.invoke('outpost:get-kiwix-download-status'),
  cancelKiwixDownload: () => ipcRenderer.invoke('outpost:cancel-kiwix-download'),
  checkForUpdates: () => ipcRenderer.invoke('outpost:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('outpost:download-update'),
  applyUpdate: () => ipcRenderer.invoke('outpost:apply-update'),
  prepareForRemoval: () => ipcRenderer.invoke('outpost:prepare-removal'),
};

contextBridge.exposeInMainWorld('outpost', bridge);
