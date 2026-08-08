import { DatabaseService } from '../../src/main/database-service';
import { PortablePathService } from '../../src/main/portable-path';
import { UpdateService } from '../../src/main/portable-update-service';

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error('Portable root is required.');
  const paths = new PortablePathService(root);
  const database = new DatabaseService(paths);
  const updates = new UpdateService(database, '0.3.0', paths);
  const result = await updates.apply(process.pid);
  database.close();
  process.stdout.write(JSON.stringify(result));
  if (result.status !== 'launching') process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
