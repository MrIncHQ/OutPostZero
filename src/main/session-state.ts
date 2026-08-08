import fs from 'node:fs';
import path from 'node:path';

interface SessionRecord {
  clean: boolean;
  processId: number;
  startedAt: string;
  closedAt?: string;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.new`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

export class SessionState {
  private readonly filePath: string;
  private record: SessionRecord;
  readonly recoveredFromUncleanShutdown: boolean;

  constructor(stateDirectory: string) {
    this.filePath = path.join(stateDirectory, 'session.json');
    let previous: SessionRecord | undefined;
    try {
      previous = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SessionRecord;
    } catch {
      previous = undefined;
    }
    this.recoveredFromUncleanShutdown = previous?.clean === false;
    this.record = { clean: false, processId: process.pid, startedAt: new Date().toISOString() };
    writeJsonAtomic(this.filePath, this.record);
  }

  markClean(): void {
    if (this.record.clean) return;
    this.record = { ...this.record, clean: true, closedAt: new Date().toISOString() };
    writeJsonAtomic(this.filePath, this.record);
  }
}
