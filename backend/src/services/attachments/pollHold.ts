/**
 * A status poll that moves the work it asks about (ADR-0063, P06 gap a).
 *
 * On Cloud Run with request-based CPU an instance gets CPU only while a request is open, so a
 * job queued by a request that has already answered may not advance at all. A poll therefore
 * wakes the worker for that file and holds the request open, up to FILE_POLL_HOLD_MS, until the
 * file's status moves; the chip's next poll does the same. Nothing waits when the file is
 * settled or still uploading.
 */
import { IN_PROGRESS } from './pipeline.js';

export async function pollWithHold<T extends { status: string }>(
  load: () => Promise<T>,
  wake: () => Promise<void>,
  holdMs: number,
): Promise<T> {
  let row = await load();
  if (row.status === 'uploading' || !IN_PROGRESS.has(row.status)) return row;
  await wake();
  const start = row.status;
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(100, Math.max(1, deadline - Date.now()))));
    row = await load();
    if (row.status !== start) break;
  }
  if (holdMs === 0) row = await load();
  return row;
}
