/**
 * Audio and video transcription at upload (Stage 9 AUDIO / M10, Stage 1 FT-6, D1 #16; P09).
 *
 * ffprobe reads the duration first: over N-10's 3 hours the file is `too_large`. ffmpeg then
 * cuts the sound into AUDIO_SEGMENT_SECONDS pieces (60–120 s, M10's segment size), each with a
 * little of the piece before it so a word cut at the boundary is heard whole once, as mono
 * MP3 at 16 kHz. Each piece is one transcription request (own deadline, one retry,
 * finish-reason check) and one segment of the transcript, `t_start`–`t_end`. Pieces go to the
 * model by `gs://` when a model-input bucket is configured (D1 #32), inline otherwise; at
 * 90 s of 48 kbit/s MP3 a piece is about 0.5 MB either way.
 *
 * ffmpeg and ffprobe are system binaries in the backend image (Dockerfile). They parse the upload
 * in native code, so they run through `runTool`: no secret in their environment, local files
 * only (`-protocol_whitelist file`), no stdin (ADR-0066).
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { isRetryableProviderError, type MediaPart, type Provider } from '../../providers/types.js';
import type { ModelInputStore } from './modelInputStore.js';
import { FileFailure } from './fileErrors.js';
import { mediaArgs, runTool } from './untrustedTools.js';
import { makeWorkDir } from './workDir.js';

/** Requests per piece: the first, and at most one retry (M10). */
const PIECE_ATTEMPTS = 2;

export interface AudioOptions {
  maxSeconds: number;
  segmentSeconds: number;
  overlapSeconds: number;
  deadlineMs: number;
  concurrency: number;
  modelInputs?: ModelInputStore;
  signal?: AbortSignal;
}

export interface Segment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  ok: boolean;
  model: string;
}

/** Seconds of sound in the file, by ffprobe. A file ffprobe cannot read is `corrupt`. */
export async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await runTool('ffprobe', mediaArgs('ffprobe', filePath, { global: ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0'] }), {
      timeout: 60_000,
      maxBuffer: 64 * 1024,
    });
    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('no duration');
    return seconds;
  } catch {
    throw new FileFailure('corrupt', 'This recording could not be opened. It may be damaged. Save it again and upload it.');
  }
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${String(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

const PROMPT =
  'Transcribe this recording verbatim, in the language it is spoken in. If it is not speech, describe what it ' +
  'contains instead. Output only the transcript or description, nothing else.';

export async function cutPiece(input: string, out: string, startS: number, lengthS: number): Promise<void> {
  await runTool(
    'ffmpeg',
    mediaArgs('ffmpeg', input, {
      global: ['-v', 'error', '-y'],
      inputOptions: ['-ss', startS.toFixed(3), '-t', lengthS.toFixed(3)],
      output: ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', out],
    }),
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
}

/**
 * One piece's transcription: a request with its own deadline, and at most one retry (M10).
 *
 * A failed request is retried only when the failure can pass on a second try (Stage 15 ER-2):
 * what the provider adapter classified retryable (`ProviderError.retryable`: 408, 409, a 429 with
 * quota, 5xx, a lost connection), or this piece's deadline, which is a timeout. An SDK timeout
 * that fires first is retried only when the adapter classified it retryable. Never a 400, 413 or other 4xx, a 429 with zero quota (`provider_quota_unavailable`),
 * an account limit (`provider_limit`), a model or credentials problem (`model_unavailable`), nor
 * an error that is not a provider error at all (a bug repeats). The turn loop uses the same
 * classification (providerLoop.ts). A reading that ended without a natural stop, or empty, is
 * read once more.
 */
export async function readPiece(
  provider: Required<Pick<Provider, 'readMedia'>>,
  part: MediaPart,
  opts: Pick<AudioOptions, 'deadlineMs' | 'signal'>,
): Promise<Pick<Segment, 'text' | 'ok' | 'model'>> {
  for (let attempt = 0; attempt < PIECE_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const deadline = AbortSignal.timeout(opts.deadlineMs);
    try {
      const r = await provider.readMedia([part], PROMPT, opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline);
      if (r.finishReason === 'STOP' && r.text.trim() !== '') return { text: r.text.trim(), ok: true, model: r.model };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (!deadline.aborted && !isRetryableProviderError(err)) break;
    }
  }
  return { text: '', ok: false, model: '' };
}

/** Transcribes the audio (or a video's sound) at `filePath` into timed segments. */
export async function transcribe(
  filePath: string,
  provider: Provider & Required<Pick<Provider, 'readMedia'>>,
  opts: AudioOptions,
): Promise<{ durationS: number; segments: Segment[] }> {
  const durationS = await probeDuration(filePath);
  if (durationS > opts.maxSeconds) {
    const hours = (opts.maxSeconds / 3600).toFixed(0);
    throw new FileFailure('too_large', `This recording is ${clock(durationS * 1000)} long. Recordings can be at most ${hours} hours.`);
  }
  const count = Math.max(1, Math.ceil(durationS / opts.segmentSeconds));
  const dir = await makeWorkDir('arcnave-audio-');
  const segments: Segment[] = new Array<Segment>(count);
  try {
    let next = 0;
    const worker = async () => {
      while (next < count) {
        const i = next++;
        const startS = i * opts.segmentSeconds;
        const endS = Math.min(durationS, startS + opts.segmentSeconds);
        const lead = Math.min(startS, opts.overlapSeconds);
        const piece = path.join(dir, `s${String(i)}.mp3`);
        await cutPiece(filePath, piece, startS - lead, endS - startS + lead);
        const data = await readFile(piece);
        await rm(piece, { force: true });
        const part: MediaPart = opts.modelInputs
          ? { mimeType: 'audio/mpeg', fileUri: await opts.modelInputs.uriFor(data, 'audio/mpeg') }
          : { mimeType: 'audio/mpeg', base64: data.toString('base64') };
        const read = await readPiece(provider, part, opts);
        segments[i] = { index: i, startMs: Math.round(startS * 1000), endMs: Math.round(endS * 1000), ...read };
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, count)) }, worker));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { durationS, segments };
}
