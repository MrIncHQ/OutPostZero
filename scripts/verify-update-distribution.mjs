import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const distribution = path.resolve(process.argv[2] ?? 'Releases/GitHubDistribution');
const publicKeyPath = path.resolve(process.argv[3] ?? 'ReleaseSigning/public.pem');
const verifyIndex = process.argv.includes('--git-index');
const manifest = JSON.parse(fs.readFileSync(path.join(distribution, 'update-manifest.json'), 'utf8'));
const signedBytes = Buffer.from(manifest.signedPayload, 'base64');
if (!crypto.verify(null, signedBytes, fs.readFileSync(publicKeyPath), Buffer.from(manifest.signature, 'base64'))) throw new Error('Update manifest signature is invalid.');
const payload = JSON.parse(signedBytes.toString('utf8'));
const files = [...payload.files, ...payload.executable.parts];

function expected(relativePath) {
  if (relativePath === payload.executable.path) return payload.executable;
  return files.find((file) => file.path === relativePath);
}
function localAudit(file) {
  const bytes = fs.readFileSync(path.join(distribution, ...file.path.split('/')));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (bytes.length !== file.size || sha256 !== file.sha256) throw new Error(`Local release bytes do not match the signed manifest: ${file.path}`);
}
async function indexAudit(file) {
  const hash = crypto.createHash('sha256'); let size = 0;
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `safe.directory=${distribution.replaceAll('\\', '/')}`, '-C', distribution, 'show', `:${file.path}`], { stdio: ['ignore', 'pipe', 'pipe'] }); let error = '';
    child.stdout.on('data', (chunk) => { hash.update(chunk); size += chunk.length; }); child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Could not read staged Git bytes for ${file.path}: ${error.trim()}`)));
  });
  const sha256 = hash.digest('hex').toUpperCase(); if (size !== file.size || sha256 !== file.sha256) throw new Error(`Staged Git bytes would fail updater verification: ${file.path}`);
}
for (const file of files) localAudit(file);
if (verifyIndex) for (const file of files) await indexAudit(file);
const executableHash = crypto.createHash('sha256'); let executableSize = 0;
for (const part of payload.executable.parts) { const bytes = fs.readFileSync(path.join(distribution, ...part.path.split('/'))); executableHash.update(bytes); executableSize += bytes.length; }
if (expected(payload.executable.path).size !== executableSize || payload.executable.sha256 !== executableHash.digest('hex').toUpperCase()) throw new Error('Executable parts do not reconstruct the signed executable.');
console.log(JSON.stringify({ version: payload.version, signature: 'valid', files: files.length, gitIndexChecked: verifyIndex, executableSize, executableSha256: payload.executable.sha256 }, null, 2));
