const pendingSaves = new Set<() => Promise<unknown>>();

export function registerPendingSave(save: () => Promise<unknown>): () => void {
  pendingSaves.add(save);
  return () => { pendingSaves.delete(save); };
}

export async function flushPendingSaves(): Promise<void> {
  const results = await Promise.allSettled([...pendingSaves].map((save) => save()));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Your latest edits could not be saved. Retry before removing the drive.');
}
