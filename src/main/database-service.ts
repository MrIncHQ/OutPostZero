import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { UpdateStatus } from '../shared/contracts';
import { PortablePathService } from './portable-path';

interface Migration {
  version: number;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS module_registry (
        module_id TEXT PRIMARY KEY NOT NULL,
        version TEXT,
        status TEXT NOT NULL,
        installed_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS update_settings (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'github')),
        repository_owner TEXT,
        repository_name TEXT,
        channel TEXT NOT NULL CHECK (channel IN ('stable', 'preview')),
        automatic_checks INTEGER NOT NULL CHECK (automatic_checks IN (0, 1)),
        last_checked_at TEXT
      ) STRICT`,
      `INSERT OR IGNORE INTO update_settings
        (singleton_id, provider, channel, automatic_checks)
        VALUES (1, 'none', 'stable', 0)`,
    ],
  },
];

export class DatabaseService {
  private readonly database: DatabaseSync;
  private readonly backupDirectory: string;
  private closed = false;

  constructor(paths: PortablePathService) {
    this.backupDirectory = paths.ensureDirectory('Backups');
    this.database = new DatabaseSync(paths.resolve('Data/outpost-zero.sqlite'));
    this.database.exec('PRAGMA journal_mode = DELETE');
    this.database.exec('PRAGMA synchronous = FULL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec('PRAGMA busy_timeout = 5000');
    this.database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    this.migrate();
  }

  private migrate(): void {
    const applied = new Set(
      (this.database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
        .map((row) => row.version),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.database.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of migration.statements) this.database.exec(statement);
        this.database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  schemaVersion(): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number };
    return row.version;
  }

  integrityCheck(): boolean {
    const row = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    return row.integrity_check === 'ok';
  }

  updateStatus(currentVersion: string): UpdateStatus {
    const row = this.database.prepare(`SELECT provider, repository_owner, repository_name,
      channel, automatic_checks, last_checked_at FROM update_settings WHERE singleton_id = 1`).get() as {
        provider: 'none' | 'github';
        repository_owner: string | null;
        repository_name: string | null;
        channel: 'stable' | 'preview';
        automatic_checks: number;
        last_checked_at: string | null;
      };
    return {
      currentVersion,
      provider: row.provider,
      repositoryOwner: row.repository_owner,
      repositoryName: row.repository_name,
      channel: row.channel,
      automaticChecks: row.automatic_checks === 1,
      lastCheckedAt: row.last_checked_at,
      configured: row.provider === 'github' && Boolean(row.repository_owner && row.repository_name),
    };
  }

  async createRotatingBackup(keep = 3): Promise<string> {
    if (this.closed) throw new Error('Cannot back up a closed database.');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.backupDirectory, `outpost-zero-${timestamp}.sqlite`);
    await backup(this.database, target);
    const backups = fs.readdirSync(this.backupDirectory)
      .filter((name) => /^outpost-zero-.*\.sqlite$/.test(name))
      .sort()
      .reverse();
    for (const obsolete of backups.slice(Math.max(1, keep))) {
      fs.unlinkSync(path.join(this.backupDirectory, obsolete));
    }
    return target;
  }

  close(): void {
    if (this.closed) return;
    this.database.exec('PRAGMA optimize');
    this.database.close();
    this.closed = true;
  }
}
