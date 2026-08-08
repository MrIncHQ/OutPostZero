import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { findPortableRoot, PortablePathService } from './portable-path';
import { SessionState } from './session-state';
import { ProfileService } from './profile-service';
import { StorageService } from './storage-service';
import { DatabaseService } from './database-service';
import { collectHardwareDiagnostics } from './hardware-service';
import { UpdateService } from './update-service';
import { ModuleService } from './module-service';
import { KiwixService } from './kiwix-service';
import type { BootstrapData, ModuleOperationResult, ModuleSummary, PortableStatus } from '../shared/contracts';

const root = findPortableRoot([path.dirname(process.execPath), process.cwd(), __dirname]);
const portablePaths = new PortablePathService(root);
const layout = portablePaths.initializeLayout();

process.env.TEMP = layout.Temp;
process.env.TMP = layout.Temp;
process.env.TMPDIR = layout.Temp;

app.setPath('userData', portablePaths.ensureDirectory('Data/State/Electron'));
app.setPath('sessionData', portablePaths.ensureDirectory('Cache/Chromium'));
app.setPath('cache', portablePaths.ensureDirectory('Cache/Electron'));
app.setPath('logs', portablePaths.ensureDirectory('Logs'));
app.setPath('temp', layout.Temp);
app.commandLine.appendSwitch('disk-cache-dir', portablePaths.ensureDirectory('Cache/Chromium/DiskCache'));
app.commandLine.appendSwitch('disable-component-update');

const sessionState = new SessionState(layout['Data/State']);
const profileService = new ProfileService(portablePaths);
const storageService = new StorageService(portablePaths);
const databaseService = new DatabaseService(portablePaths);
const updateService = new UpdateService(databaseService, app.getVersion(), portablePaths);
const moduleService = new ModuleService(databaseService, portablePaths);
const kiwixService = new KiwixService(databaseService, portablePaths);
let isPrepared = false;
let shutdownInProgress = false;

function modules(): ModuleSummary[] {
  return [kiwixService.summary(), ...moduleService.modules().filter((module) => module.id !== 'library-engine')];
}

function getStatus(): PortableStatus {
  let diskSpace: ReturnType<typeof fs.statfsSync> | undefined;
  try {
    diskSpace = fs.statfsSync(root);
  } catch {
    diskSpace = undefined;
  }
  return {
    root,
    rootLabel: path.basename(root),
    platform: process.platform,
    architecture: process.arch,
    version: app.getVersion(),
    freeBytes: diskSpace ? diskSpace.bavail * diskSpace.bsize : null,
    totalBytes: diskSpace ? diskSpace.blocks * diskSpace.bsize : null,
    recoveredFromUncleanShutdown: sessionState.recoveredFromUncleanShutdown,
    portablePaths: {
      data: portablePaths.resolve('Data'),
      cache: portablePaths.resolve('Cache'),
      temp: portablePaths.resolve('Temp'),
      logs: portablePaths.resolve('Logs'),
    },
  };
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111714',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.OUTPOST_ZERO_DEV_SERVER_URL;
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault();
  });

  const devServerUrl = process.env.OUTPOST_ZERO_DEV_SERVER_URL;
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(path.join(__dirname, '../../renderer/index.html'));
}

ipcMain.handle('outpost:get-bootstrap', async (): Promise<BootstrapData> => ({
  status: getStatus(),
  profile: profileService.read(),
  storage: await storageService.summarize(),
  modules: modules(),
  hardware: await collectHardwareDiagnostics(app.getGPUInfo('basic')),
  updates: updateService.status(),
  database: {
    schemaVersion: databaseService.schemaVersion(),
    integrityOk: databaseService.integrityCheck(),
  },
}));
ipcMain.handle('outpost:create-profile', (_event, displayName: unknown) => {
  if (typeof displayName !== 'string') throw new Error('Display name must be text.');
  return profileService.create(displayName);
});
ipcMain.handle('outpost:update-profile', (_event, displayName: unknown) => {
  if (typeof displayName !== 'string') throw new Error('Display name must be text.');
  return profileService.update(displayName);
});
ipcMain.handle('outpost:refresh-storage', () => storageService.summarize());
ipcMain.handle('outpost:refresh-hardware', () => collectHardwareDiagnostics(app.getGPUInfo('basic')));
ipcMain.handle('outpost:refresh-modules', () => modules());
function moduleId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value)) throw new Error('Module identifier is invalid.');
  return value;
}
async function moduleAction(action: 'install' | 'start' | 'stop' | 'repair' | 'uninstall', value: unknown): Promise<ModuleOperationResult> {
  const id = moduleId(value);
  if (id === 'library-engine') {
    const result = action === 'install' ? await kiwixService.install()
      : action === 'start' ? await kiwixService.start()
        : action === 'stop' ? await kiwixService.stop()
          : action === 'repair' ? await kiwixService.repair()
            : await kiwixService.uninstall();
    return { ...result, modules: modules() };
  }
  const result = action === 'install' ? await moduleService.install(id)
    : action === 'start' ? await moduleService.start(id)
      : action === 'stop' ? await moduleService.stop(id)
        : action === 'repair' ? await moduleService.repair(id)
          : await moduleService.uninstall(id);
  return { ...result, modules: modules() };
}
ipcMain.handle('outpost:install-module', (_event, value: unknown) => moduleAction('install', value));
ipcMain.handle('outpost:start-module', (_event, value: unknown) => moduleAction('start', value));
ipcMain.handle('outpost:stop-module', (_event, value: unknown) => moduleAction('stop', value));
ipcMain.handle('outpost:repair-module', (_event, value: unknown) => moduleAction('repair', value));
ipcMain.handle('outpost:uninstall-module', (_event, value: unknown) => moduleAction('uninstall', value));
ipcMain.handle('outpost:get-library-status', () => kiwixService.status());
ipcMain.handle('outpost:scan-library', () => kiwixService.status());
ipcMain.handle('outpost:install-kiwix-sample', () => kiwixService.installSample());
ipcMain.handle('outpost:check-updates', () => updateService.check());
ipcMain.handle('outpost:download-update', () => updateService.download());
ipcMain.handle('outpost:apply-update', async () => {
  await Promise.all([moduleService.stopAll(), kiwixService.stop(true)]);
  await databaseService.createRotatingBackup();
  const result = updateService.apply(process.pid);
  if (result.status === 'launching') {
    databaseService.close();
    sessionState.markClean();
    isPrepared = true;
    setTimeout(() => app.quit(), 250);
  }
  return result;
});
ipcMain.handle('outpost:prepare-removal', async () => {
  await Promise.all([moduleService.stopAll(), kiwixService.stop(true)]);
  await session.defaultSession.clearCache();
  await databaseService.createRotatingBackup();
  databaseService.close();
  sessionState.markClean();
  isPrepared = true;
  return { ready: true, message: 'All Outpost Zero data is flushed. Close the app, then safely eject the drive.' };
});

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:5173; frame-src http://127.0.0.1:*"],
      },
    });
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if ((moduleService.hasRunningModules() || kiwixService.hasRunningProcess()) && !shutdownInProgress) {
    event.preventDefault();
    shutdownInProgress = true;
    void Promise.all([moduleService.stopAll(), kiwixService.stop(true)]).finally(() => app.quit());
    return;
  }
  databaseService.close();
  if (!isPrepared) sessionState.markClean();
});
