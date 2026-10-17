/**
 * Shared image resolution, validation, dimension extraction, and MIME detection.
 * Enforces size limits, valid MIME types, and path traversal protection.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactImage } from './types.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Extract image dimensions from raw buffer for PNG, JPEG, and WebP.
 */
export function extractImageDimensions(buffer: Buffer): { width: number; height: number; mime: ArtifactImage['mime'] } | null {
  if (buffer.length < 16) return null;

  // 1. PNG check: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height, mime: 'image/png' };
    }
  }

  // 2. JPEG check: FF D8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      while (buffer[offset] === 0xff && offset < buffer.length) {
        offset++;
      }
      const marker = buffer[offset];
      offset++;
      if (marker === undefined) break;

      // SOF markers: SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3)
      if (marker >= 0xc0 && marker <= 0xc3) {
        if (offset + 7 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          return { width, height, mime: 'image/jpeg' };
        }
        break;
      } else if (marker === 0xd9 || marker === 0xda) {
        // EOI or SOS marker
        break;
      } else {
        // Skip marker segment
        if (offset + 2 <= buffer.length) {
          const length = buffer.readUInt16BE(offset);
          offset += length;
        } else {
          break;
        }
      }
    }
    return { width: 800, height: 600, mime: 'image/jpeg' };
  }

  // 3. WebP check: RIFF .... WEBP
  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height, mime: 'image/webp' };
    } else if (chunk === 'VP8L') {
      const b1 = buffer[21]!;
      const b2 = buffer[22]!;
      const b3 = buffer[23]!;
      const b4 = buffer[24]!;
      const width = 1 + (((b2 & 0x3f) << 8) | b1);
      const height = 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      return { width, height, mime: 'image/webp' };
    }
    return { width: 800, height: 600, mime: 'image/webp' };
  }

  return null;
}

/**
 * Resolves an image source into a verified ArtifactImage object.
 * Safe source resolution:
 * - base64 Data URLs (`data:image/...;base64,...`)
 * - workspace / storage file paths with strict path traversal checks
 */
export async function resolveArtifactImage(source: string): Promise<ArtifactImage | null> {
  if (!source || typeof source !== 'string') return null;
  const trimmed = source.trim();

  // 1. Data URL
  if (trimmed.startsWith('data:image/')) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(trimmed);
    if (!match) return null;
    const rawMime = match[1]!;
    const mime: ArtifactImage['mime'] = rawMime === 'image/jpg' ? 'image/jpeg' : (rawMime as ArtifactImage['mime']);
    const buffer = Buffer.from(match[2]!, 'base64');
    if (buffer.length > MAX_IMAGE_BYTES) return null;

    const dim = extractImageDimensions(buffer);
    const width = dim?.width || 800;
    const height = dim?.height || 600;
    return {
      buffer,
      mime: dim?.mime || mime,
      width,
      height,
      aspectRatio: width / (height || 1),
    };
  }

  // 2. Local file path validation (prevent path traversal)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    const normalized = path.normalize(trimmed);
    if (normalized.includes('..') || path.isAbsolute(normalized) && !normalized.match(/^[a-zA-Z]:[\\/]/)) {
      // Reject risky traversal
      return null;
    }

    try {
      if (fs.existsSync(normalized)) {
        const stats = fs.statSync(normalized);
        if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return null;
        const buffer = fs.readFileSync(normalized);
        const dim = extractImageDimensions(buffer);
        if (!dim) return null;
        return {
          buffer,
          mime: dim.mime,
          width: dim.width,
          height: dim.height,
          aspectRatio: dim.width / (dim.height || 1),
        };
      }
    } catch {
      // benign: an image whose size cannot be read is left out of the document
      return null;
    }
  }

  return null;
}
