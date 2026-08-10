import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LocalProfile } from '../shared/contracts';
import { PortablePathService } from './portable-path';

const PROFILE_VERSION = 1;

interface StoredProfile extends LocalProfile {
  version: number;
}

function writeAtomic(filePath: string, content: string, mode?: number): void {
  const temporaryPath = `${filePath}.new`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode });
  fs.renameSync(temporaryPath, filePath);
}

export function validateDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 32) {
    throw new Error('Display name must be between 2 and 32 characters.');
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Display name contains unsupported control characters.');
  }
  return name;
}

export class ProfileService {
  private readonly profilePath: string;
  private readonly privateKeyPath: string;
  private readonly publicKeyPath: string;

  constructor(paths: PortablePathService) {
    this.profilePath = paths.resolve('Profile/profile.json');
    const identityDirectory = paths.ensureDirectory('Profile/Identity');
    this.privateKeyPath = path.join(identityDirectory, 'device-private.pem');
    this.publicKeyPath = path.join(identityDirectory, 'device-public.pem');
  }

  read(): LocalProfile | null {
    try {
      const stored = JSON.parse(fs.readFileSync(this.profilePath, 'utf8')) as StoredProfile;
      if (stored.version !== PROFILE_VERSION || !stored.displayName || !stored.deviceFingerprint) return null;
      return {
        displayName: stored.displayName,
        createdAt: stored.createdAt,
        deviceFingerprint: stored.deviceFingerprint,
      };
    } catch {
      return null;
    }
  }

  create(displayName: string): LocalProfile {
    const existing = this.read();
    if (existing) return this.update(displayName);

    const name = validateDisplayName(displayName);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    writeAtomic(this.privateKeyPath, privatePem, 0o600);
    writeAtomic(this.publicKeyPath, publicPem);

    const publicDer = publicKey.export({ format: 'der', type: 'spki' });
    const digest = crypto.createHash('sha256').update(publicDer).digest('hex').toUpperCase();
    const fingerprint = digest.match(/.{1,4}/g)?.slice(0, 8).join('-') ?? digest;
    const profile: StoredProfile = {
      version: PROFILE_VERSION,
      displayName: name,
      createdAt: new Date().toISOString(),
      deviceFingerprint: fingerprint,
    };
    writeAtomic(this.profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    return {
      displayName: profile.displayName,
      createdAt: profile.createdAt,
      deviceFingerprint: profile.deviceFingerprint,
    };
  }

  update(displayName: string): LocalProfile {
    const existing = this.read();
    if (!existing) throw new Error('Create a local profile before updating it.');
    const profile: StoredProfile = {
      version: PROFILE_VERSION,
      ...existing,
      displayName: validateDisplayName(displayName),
    };
    writeAtomic(this.profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    return profile;
  }

  publicKeyPem(): string {
    if (!this.read() || !fs.existsSync(this.publicKeyPath)) throw new Error('A local identity is required for Local Relay.');
    return fs.readFileSync(this.publicKeyPath, 'utf8');
  }

  sign(data: Uint8Array): string {
    if (!this.read() || !fs.existsSync(this.privateKeyPath)) throw new Error('A local identity is required for Local Relay.');
    return crypto.sign(null, data, fs.readFileSync(this.privateKeyPath, 'utf8')).toString('base64');
  }
}
