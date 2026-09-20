// Run after building: electron tests/electron-portability-smoke.cjs
// Uses only a disposable fixture, never the project's or an external drive's data.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-portability-smoke-'));
const load = name => require(path.join(project, 'dist/main/main', name));
const { PortablePathService } = load('portable-path.js');
const { DatabaseService } = load('database-service.js');
const { ProfileService } = load('profile-service.js');
const { NoteService } = load('note-service.js');
fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
const paths = new PortablePathService(root);
paths.initializeLayout();
const db = new DatabaseService(paths);
const schema = db.schemaVersion();
const note = new NoteService(db, paths).save({ title: 'Existing note', body: 'Existing data', folder: '', tags: [], pinned: false, favorite: false });
db.close();
new ProfileService(paths).create('Existing Operator');
const legacy = paths.ensureDirectory('Data/State/Electron');
fs.writeFileSync(path.join(legacy, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIinvalid-from-other-machine').toString('base64') } }));
fs.writeFileSync(paths.resolve('Content/Documents/existing.txt'), 'Keep this library file');
fs.writeFileSync(paths.resolve('Config/existing.json'), '{"keep":true}');
const preserved = ['Profile/profile.json', 'Profile/Identity/device-private.pem', 'Profile/Identity/device-public.pem', 'Content/Documents/existing.txt', 'Config/existing.json', 'Data/State/Electron/Local State'];
const before = new Map(preserved.map(file => [file, fs.readFileSync(paths.resolve(file))]));
process.env.OUTPOST_ZERO_ROOT = root;
app.setAppPath(project);
app.commandLine.appendSwitch('user-data-dir', legacy);
app.commandLine.appendSwitch('disk-cache-dir', paths.ensureDirectory('Cache/Chromium/DiskCache'));
const timeout = setTimeout(() => { console.error('Smoke test timed out:', root); app.exit(1); }, 45_000);
app.on('browser-window-created', (_event, window) => {
  window.hide();
  window.on('show', () => window.hide());
  window.webContents.once('did-finish-load', async () => {
    try {
      assert.match(app.getPath('userData'), /Cache[\\/]BrowserProfiles[\\/][a-f0-9]{64}$/);
      assert.equal(app.commandLine.getSwitchValue('user-data-dir'), app.getPath('userData'));
      await window.webContents.executeJavaScript(`(async () => {
        const waitFor = async (check) => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('UI did not become ready'); };
        await waitFor(() => document.querySelector('.eject-button'));
        [...document.querySelectorAll('nav button')].find(b => b.querySelector('b')?.textContent === 'Notes').click();
        await waitFor(() => [...document.querySelectorAll('.notes-list button')].some(b => b.textContent.includes('Existing note')));
        [...document.querySelectorAll('.notes-list button')].find(b => b.textContent.includes('Existing note')).click();
        await waitFor(() => document.querySelector('.note-writing textarea'));
        const textarea = document.querySelector('.note-writing textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Latest edit saved during removal');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 30));
        document.querySelector('.eject-button').click();
        await waitFor(() => document.querySelector('#removal-title')?.textContent === 'Ready to close Outpost Zero');
        if (document.querySelector('.app-shell')) throw new Error('App controls remain available after removal');
        const repeat = await window.outpost.prepareForRemoval();
        if (!repeat.ready) throw new Error('Repeated preparation failed');
      })()`);
      for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(paths.resolve(file)), bytes, file);
      const reopened = new DatabaseService(paths);
      assert.equal(reopened.schemaVersion(), schema);
      assert.equal(reopened.note(note.id).body, 'Latest edit saved during removal');
      assert.equal(reopened.integrityCheck(), true);
      reopened.close();
      console.log(JSON.stringify({ result: 'passed', root, schemaUnchanged: true, existingFilesPreserved: preserved.length, pendingNoteSaved: true, repeatRemoval: 'passed', oldLauncher: 'passed' }));
      clearTimeout(timeout);
      app.quit();
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require(path.join(project, 'dist/main/main/main.js'));
