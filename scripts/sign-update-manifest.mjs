import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [distributionArgument, privateKeyArgument, version] = process.argv.slice(2);
if (!distributionArgument || !privateKeyArgument || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: node scripts/sign-update-manifest.mjs <distribution> <private-key> <version>');
}

const distribution = fs.realpathSync(distributionArgument);
const privateKeyPath = fs.realpathSync(privateKeyArgument);
const excludedRootFiles = new Set(['.gitattributes', '.outpost-zero-root', 'README.md', 'update-manifest.json']);
const excludedDistributionRoots = new Set(['nature', 'updatechannel']);
const protectedRoots = new Set([
  'ai', 'backups', 'cache', 'config', 'content', 'data', 'downloads',
  'exports', 'logs', 'modules', 'profile', 'runtimeparts', 'temp', 'updates',
]);

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

async function fileMetadata(relativePath) {
  const filePath = path.join(distribution, ...relativePath.split('/'));
  const stats = fs.statSync(filePath);
  return { path: relativePath, size: stats.size, sha256: await hashFile(filePath) };
}

function walk(directory, relativeDirectory = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const allFiles = walk(distribution);
const runtimeFiles = allFiles
  .filter((relativePath) => {
    const segments = relativePath.split('/');
    if (segments.length === 1 && excludedRootFiles.has(relativePath)) return false;
    if (excludedDistributionRoots.has(segments[0].toLowerCase())) return false;
    return segments[0].toLowerCase() !== 'runtimeparts';
  })
  .sort();

for (const relativePath of runtimeFiles) {
  const firstSegment = relativePath.split('/')[0].toLowerCase();
  if (protectedRoots.has(firstSegment)) throw new Error(`Refusing to sign protected path: ${relativePath}`);
  if (relativePath === 'Outpost Zero.exe') throw new Error('Distribution must contain executable parts, not a complete executable.');
}

const partPaths = allFiles
  .filter((relativePath) => /^RuntimeParts\/OutpostZero\.exe\.\d{3}$/.test(relativePath))
  .sort();
if (partPaths.length !== 3) throw new Error(`Expected exactly 3 executable parts, found ${partPaths.length}.`);

const files = [];
for (const relativePath of runtimeFiles) files.push(await fileMetadata(relativePath));
const parts = [];
const executableHash = crypto.createHash('sha256');
let executableSize = 0;
for (const relativePath of partPaths) {
  const metadata = await fileMetadata(relativePath);
  parts.push(metadata);
  executableSize += metadata.size;
  const stream = fs.createReadStream(path.join(distribution, ...relativePath.split('/')));
  for await (const chunk of stream) executableHash.update(chunk);
}

const payload = {
  schemaVersion: 1,
  version,
  releaseRef: `runtime-v${version}`,
  publishedAt: new Date().toISOString(),
  platform: 'win32',
  architecture: 'x64',
  files,
  executable: {
    path: 'Outpost Zero.exe',
    size: executableSize,
    sha256: executableHash.digest('hex').toUpperCase(),
    parts,
  },
};

const signedPayload = Buffer.from(JSON.stringify(payload));
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const signature = crypto.sign(null, signedPayload, privateKey);
const envelope = {
  schemaVersion: 1,
  signedPayload: signedPayload.toString('base64'),
  signature: signature.toString('base64'),
};
const manifestPath = path.join(distribution, 'update-manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  manifestPath,
  version,
  runtimeFiles: files.length,
  executableParts: parts.length,
  executableSize,
  executableSha256: payload.executable.sha256,
}, null, 2));
