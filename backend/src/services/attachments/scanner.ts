/**
 * Malware scanning (Stage 9 SCAN, Stage 16 FL-1, Stage 20 VS-12c; P19).
 *
 * `FILE_SCANNER=clamd` streams each file to clamd with INSTREAM over TCP; `none` runs the
 * `scanning` stage with a scanner that passes every file and never claims a file was scanned.
 * The clamd daemon itself is infra (the owner deploys it); this is only the client.
 *
 * clamd's INSTREAM protocol (clamd(8)): send `zINSTREAM\0`, then the file as chunks, each
 * prefixed by its length as a 4-byte big-endian integer, then a zero-length chunk. clamd
 * answers one NUL-terminated line: `stream: OK`, `stream: <signature> FOUND`, or
 * `INSTREAM size limit exceeded. ERROR` when the stream passed its StreamMaxLength.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import net from 'node:net';

import type { Config } from '../../config.js';
import { FileFailure } from './fileErrors.js';

export interface Scanner {
  /** Throws `FileFailure('malware')` for a harmful file, `scan_incomplete` when it cannot tell. */
  scan(localPath: string): Promise<void>;
  /** For logs and the sidecar: which scanner ran. */
  readonly name: string;
}

/** FILE_SCANNER=none: the stage runs, nothing is scanned. The UI never says "scanned". */
export const noScanner: Scanner = { name: 'none', scan: async () => undefined };

export interface ClamdOptions {
  host: string;
  port: number;
  timeoutMs: number;
  /** clamd's StreamMaxLength; a longer file cannot be scanned whole. */
  maxBytes: number;
}

const CHUNK = 64 * 1024;

export class ClamdScanner implements Scanner {
  readonly name = 'clamd';
  constructor(private readonly opts: ClamdOptions) {}

  async scan(localPath: string): Promise<void> {
    const { size } = await stat(localPath);
    // Sending it anyway would be cut by clamd and scan only the head (Stage 9 SCAN).
    if (size > this.opts.maxBytes) throw new FileFailure('scan_incomplete');
    const reply = await this.instream(localPath).catch((err: unknown) => {
      if (err instanceof FileFailure) throw err;
      // clamd down, refused, reset: we cannot say the file is clean.
      throw new FileFailure('scan_incomplete');
    });
    if (/\bFOUND$/.test(reply)) throw new FileFailure('malware');
    if (!/:\s*OK$/.test(reply)) throw new FileFailure('scan_incomplete');
  }

  private instream(localPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: this.opts.host, port: this.opts.port });
      let answer = '';
      let settled = false;
      const done = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value ?? '');
      };
      const timer = setTimeout(() => done(new FileFailure('scan_incomplete')), this.opts.timeoutMs);
      socket.on('error', (err) => done(err));
      socket.on('data', (chunk: Buffer) => {
        answer += chunk.toString('utf8');
        const end = answer.indexOf('\0');
        if (end !== -1) done(null, answer.slice(0, end).trim());
      });
      socket.on('end', () => done(null, answer.replace(/\0/g, '').trim()));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const file = createReadStream(localPath, { highWaterMark: CHUNK });
        file.on('data', (data) => {
          const buf = typeof data === 'string' ? Buffer.from(data) : data;
          const len = Buffer.alloc(4);
          len.writeUInt32BE(buf.length, 0);
          if (!socket.write(Buffer.concat([len, buf]))) {
            file.pause();
            socket.once('drain', () => file.resume());
          }
        });
        file.on('error', (err) => done(err));
        file.on('end', () => socket.write(Buffer.alloc(4)));
      });
    });
  }
}

export function scannerFor(cfg: Config): Scanner {
  if (cfg.FILE_SCANNER === 'clamd') {
    return new ClamdScanner({
      host: cfg.CLAMD_HOST,
      port: cfg.CLAMD_PORT,
      timeoutMs: cfg.CLAMD_TIMEOUT_MS,
      maxBytes: cfg.CLAMD_STREAM_MAX_BYTES,
    });
  }
  return noScanner;
}
