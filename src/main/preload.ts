import { contextBridge, ipcRenderer } from 'electron';
import type { OutpostBridge } from '../shared/contracts';

const bridge: OutpostBridge = {
  getBootstrap: () => ipcRenderer.invoke('outpost:get-bootstrap'),
  createProfile: (displayName) => ipcRenderer.invoke('outpost:create-profile', displayName),
  updateProfile: (displayName) => ipcRenderer.invoke('outpost:update-profile', displayName),
  refreshStorage: () => ipcRenderer.invoke('outpost:refresh-storage'),
  refreshHardware: () => ipcRenderer.invoke('outpost:refresh-hardware'),
  checkForUpdates: () => ipcRenderer.invoke('outpost:check-updates'),
  prepareForRemoval: () => ipcRenderer.invoke('outpost:prepare-removal'),
};

contextBridge.exposeInMainWorld('outpost', bridge);
