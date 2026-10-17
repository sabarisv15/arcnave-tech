/**
 * Review R7 (p05 round 1): a reconnect whose stored snapshot is older than the hub buffer's head
 * must not resume live from the buffer, or the frames between the snapshot and the head are
 * skipped. It follows the stored row instead.
 */
import { describe, expect, it } from 'vitest';

import { Run } from '../services/runHub.js';
import type { StreamEvent } from '../services/turn/events.js';
import { type LiveConnection, type SnapshotFrame, streamLive } from './turnStream.js';

function fakeConnection(): LiveConnection & { frames: Array<{ type: string; id: number | undefined }> } {
  let close!: () => void;
  const closed = new Promise<void>((r) => (close = r));
  const frames: Array<{ type: string; id: number | undefined }> = [];
  return {
    frames,
    closed,
    frame: (event: { type: string }, id?: number) => frames.push({ type: event.type, id }),
    end: () => close(),
  };
}

function runWith(events: number, maxBuffered: number): Run {
  const run = new Run('chat', 'user', 'message', new AbortController(), 'turn', maxBuffered);
  for (let i = 0; i < events; i += 1) run.publish({ type: 'delta', text: String(i) } as StreamEvent);
  return run;
}

const snap = (seq: number): SnapshotFrame => ({ type: 'snapshot', turnId: 'turn', state: 'running', seq, message: {} });

describe('streamLive with a tiny buffer (review R7)', () => {
  it('a snapshot older than the buffer head follows the stored row, not the buffer', async () => {
    // 10 frames, 3 kept: the buffer holds 7..9.
    const run = runWith(10, 3);
    expect(run.firstBuffered).toBe(7);
    const conn = fakeConnection();
    let stored = 0;
    const done = streamLive(conn, run, 0, async () => snap(2), async () => {
      stored += 1;
      conn.end();
    });
    run.finish();
    await done;
    expect(stored).toBe(1);
    // Nothing from the buffer: frames 3..6 would have been missing between the snapshot and 7.
    expect(conn.frames.filter((f) => f.type === 'delta')).toEqual([]);
  });

  it('a snapshot the buffer continues from resumes live with no gap', async () => {
    const run = runWith(10, 3);
    const conn = fakeConnection();
    let stored = 0;
    const done = streamLive(conn, run, 0, async () => snap(6), async () => {
      stored += 1;
    });
    run.finish();
    await done;
    expect(stored).toBe(0);
    expect(conn.frames.map((f) => f.id)).toEqual([6, 7, 8, 9]);
  });
});
