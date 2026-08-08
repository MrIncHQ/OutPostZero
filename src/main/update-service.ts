import type { UpdateCheckResult, UpdateStatus } from '../shared/contracts';
import { DatabaseService } from './database-service';

export class UpdateService {
  constructor(private readonly database: DatabaseService, private readonly currentVersion: string) {}

  status(): UpdateStatus {
    return this.database.updateStatus(this.currentVersion);
  }

  async check(): Promise<UpdateCheckResult> {
    const status = this.status();
    if (!status.configured) {
      return {
        status: 'not-configured',
        message: 'No update source is configured yet. A GitHub Releases repository can be connected after the base application is published.',
        currentVersion: this.currentVersion,
      };
    }

    return {
      status: 'not-configured',
      message: 'The GitHub source is recorded, but signed release downloads are intentionally locked until the updater milestone.',
      currentVersion: this.currentVersion,
    };
  }
}
