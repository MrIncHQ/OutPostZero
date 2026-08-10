import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { ProfileService } from '../src/main/profile-service';
import { RelayService } from '../src/main/relay-service';

function createRelay(name: string, discoveryPort: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-relay-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root); paths.initializeLayout();
  const profile = new ProfileService(paths); profile.create(name);
  return { root, paths, relay: new RelayService(profile, paths, { discoveryPort }) };
}
async function waitFor<T>(read: () => T | undefined, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for Local Relay state.');
}

test('two portable roots discover, authenticate, message, and transfer a verified file over TLS 1.3', { timeout: 40_000 }, async () => {
  const discoveryPort = 46_000 + Math.floor(Math.random() * 1_000); const alpha = createRelay('Alpha Outpost', discoveryPort); const bravo = createRelay('Bravo Outpost', discoveryPort);
  let replacement: ReturnType<typeof createRelay> | undefined;
  try {
    assert.equal((await alpha.relay.start()).ok, true); assert.equal((await bravo.relay.start()).ok, true);
    const bravoPeer = await waitFor(() => alpha.relay.state().peers.find((peer) => peer.displayName === 'Bravo Outpost'));
    const alphaPeer = await waitFor(() => bravo.relay.state().peers.find((peer) => peer.displayName === 'Alpha Outpost'));
    assert.equal(bravoPeer.online, true); assert.equal(alphaPeer.online, true); assert.equal(bravoPeer.verificationCode, alphaPeer.verificationCode);
    alpha.relay.verifyPeer(bravoPeer.id); bravo.relay.verifyPeer(alphaPeer.id);

    const direct = await alpha.relay.sendMessage(bravoPeer.id, 'direct', 'Generator is ready.'); assert.equal(direct.ok, true);
    const received = await waitFor(() => bravo.relay.state().messages.find((message) => message.body === 'Generator is ready.'));
    assert.equal(received.direction, 'incoming'); assert.equal(received.delivered, true);
    const internal = alpha.relay as unknown as { sendMessageFrame(peer: unknown, id: string, scope: 'direct', body: string, sentAt: string): Promise<void>; stored: { peers: unknown[] } };
    const replayId = crypto.randomUUID(); const storedBravo = internal.stored.peers.find((item) => (item as { id: string }).id === bravoPeer.id)!;
    await internal.sendMessageFrame(storedBravo, replayId, 'direct', 'Replay proof.', new Date().toISOString());
    await assert.rejects(() => internal.sendMessageFrame(storedBravo, replayId, 'direct', 'Replay proof.', new Date().toISOString()));
    assert.equal(bravo.relay.state().messages.filter((item) => item.id === replayId).length, 1);
    const room = await bravo.relay.sendMessage('room', 'room', 'Local room check.'); assert.equal(room.ok, true);
    assert.ok(await waitFor(() => alpha.relay.state().messages.find((message) => message.body === 'Local room check.')));

    const source = path.join(alpha.root, 'relay-proof.txt'); const content = Buffer.alloc(180_000, 0x5a); fs.writeFileSync(source, content);
    assert.equal((await alpha.relay.sendFile(bravoPeer.id, source)).ok, true);
    const offer = await waitFor(() => bravo.relay.state().transfers.find((transfer) => transfer.status === 'offered'));
    assert.equal(bravo.relay.acceptFile(offer.id, 'documents').ok, true);
    const complete = await waitFor(() => bravo.relay.state().transfers.find((transfer) => transfer.id === offer.id && transfer.status === 'complete'), 20_000);
    assert.ok(complete.relativePath); assert.deepEqual(fs.readFileSync(bravo.paths.resolve(complete.relativePath!)), content);
    assert.equal(alpha.relay.state().transfers.find((transfer) => transfer.id === offer.id)?.status, 'complete');

    bravo.relay.setHistory(false); assert.equal((await alpha.relay.sendMessage(bravoPeer.id, 'direct', 'Session-only secret.')).ok, true);
    await waitFor(() => bravo.relay.state().messages.find((message) => message.body === 'Session-only secret.'));
    assert.doesNotMatch(fs.readFileSync(bravo.paths.resolve('Data/Chat/relay-state.json'), 'utf8'), /Session-only secret/);
    await bravo.relay.stop(); replacement = createRelay('Bravo Outpost', discoveryPort); await replacement.relay.start();
    const changed = await waitFor(() => alpha.relay.state().peers.find((item) => item.id !== bravoPeer.id && item.displayName === 'Bravo Outpost'));
    assert.equal(changed.identityChanged, true); assert.equal(changed.verified, false);
  } finally { await Promise.all([alpha.relay.stop(), bravo.relay.stop(), replacement?.relay.stop()]); }
});

test('relay page replaces the placeholder and exposes explicit trust, history, and file controls', () => {
  const app = fs.readFileSync('src/renderer/App.tsx', 'utf8'); const view = fs.readFileSync('src/renderer/RelayView.tsx', 'utf8');
  assert.doesNotMatch(app, /relay:\s*\{[^}]*PHASE 6/); assert.match(app, /view === 'relay'.*<Suspense.*<RelayView/s);
  for (const feature of ['START LOCAL RELAY', 'TLS 1.3', 'MARK VERIFIED', 'IDENTITY CHANGED', 'Local Room', 'SEND FILE', 'SAVE TO DOCUMENTS', 'SHA-256 VERIFIED']) assert.match(view, new RegExp(feature));
});

test('release signing excludes Git metadata and provides a staged-byte audit', () => {
  const signer = fs.readFileSync('scripts/sign-update-manifest.mjs', 'utf8'); const audit = fs.readFileSync('scripts/verify-update-distribution.mjs', 'utf8');
  assert.match(signer, /'\.gitattributes'/); assert.match(audit, /Staged Git bytes would fail updater verification/);
  assert.equal(fs.readFileSync('Releases/GitHubDistribution/.gitattributes', 'utf8').trim(), '* binary');
});
