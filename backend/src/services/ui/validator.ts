/**
 * ArcNave Phase 6 UI Validator & Normalizer.
 *
 * Normalizes input blocks with stable blockId and sequence, validates via Zod,
 * enforces global response byte ceilings, and safely extracts sanitized fallback
 * text when validation fails.
 */
import crypto from 'node:crypto';
import { uiResponseV1Schema } from './schemas.js';
import type { UIBlock, UIResponseV1 } from './types.js';

export interface ValidationSuccess {
  ok: true;
  data: UIResponseV1;
}

export interface ValidationFailure {
  ok: false;
  fallbackText: string;
  error: string;
  /** Stable code for failures a caller acts on, e.g. `visual_too_large`. */
  code?: string;
}

/** Per visual block (ADR-0035). Its HTML is counted here, not in the response's own byte cap. */
export const VISUAL_MAX_HTML_BYTES = 200_000;
export const VISUAL_MAX_PER_RESPONSE = 2;

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Strips HTML tags, `<script>` blocks, and dangerous event handlers from raw text.
 */
export function sanitizeInertText(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:\s*/gi, '')
    .replace(/\bon[a-z]+\s*=\s*['"][^'"]*['"]/gi, '')
    .trim();
}

/**
 * Normalizes and validates incoming UI blocks.
 *
 * @param input Raw model tool arguments e.g. { blocks: [...] }
 * @param maxBytes Global UTF-8 byte cap on serialized payload (default 100,000)
 */
export function validateAndNormalizeUI(input: unknown, maxBytes: number = 100_000): ValidationResult {
  let parsedInput = input;
  if (typeof parsedInput === 'string') {
    try {
      parsedInput = JSON.parse(parsedInput);
    } catch {
      // benign: not JSON text: validated as given
      // ignore
    }
  }

  if (!parsedInput || typeof parsedInput !== 'object') {
    return {
      ok: false,
      fallbackText: 'Structured view could not be rendered.',
      error: 'Input must be a non-null object.',
    };
  }

  let raw = parsedInput as { blocks?: unknown };
  if (typeof raw.blocks === 'string') {
    try {
      const parsedBlocks = JSON.parse(raw.blocks);
      if (Array.isArray(parsedBlocks)) {
        raw = { blocks: parsedBlocks };
      } else if (parsedBlocks && typeof parsedBlocks === 'object' && Array.isArray((parsedBlocks as any).blocks)) {
        raw = { blocks: (parsedBlocks as any).blocks };
      }
    } catch {
      // benign: not JSON text: validated as given
      // ignore
    }
  }

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    return {
      ok: false,
      fallbackText: 'Structured view could not be rendered.',
      error: 'Input must contain a non-empty "blocks" array.',
    };
  }

  // Visuals carry their own HTML cap; the response cap below counts everything else.
  const visuals = raw.blocks.filter(
    (b): b is Record<string, unknown> => !!b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'visual',
  );
  if (visuals.length > VISUAL_MAX_PER_RESPONSE) {
    return {
      ok: false,
      code: 'visual_limit',
      fallbackText: 'The visual could not be drawn.',
      error: `visual_limit: ${visuals.length} visual blocks; at most ${VISUAL_MAX_PER_RESPONSE} per response.`,
    };
  }
  for (const v of visuals) {
    const bytes = typeof v['html'] === 'string' ? Buffer.byteLength(v['html'], 'utf8') : 0;
    if (bytes > VISUAL_MAX_HTML_BYTES) {
      return {
        ok: false,
        code: 'visual_too_large',
        fallbackText: 'The visual could not be drawn because its HTML is too large.',
        error: `visual_too_large: visual HTML is ${bytes} bytes; the limit is ${VISUAL_MAX_HTML_BYTES}.`,
      };
    }
  }

  // Pre-serialization byte limit check
  const serialized = JSON.stringify({
    ...raw,
    blocks: raw.blocks.map((b) => (visuals.includes(b as Record<string, unknown>) ? { ...(b as object), html: '' } : b)),
  });
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return {
      ok: false,
      fallbackText: 'Structured view could not be rendered because it exceeded the maximum allowed size.',
      error: `Payload size (${Buffer.byteLength(serialized, 'utf8')} bytes) exceeds limit (${maxBytes} bytes).`,
    };
  }

  // Normalize blocks: inject blockId and sequence if missing or invalid
  const normalizedBlocks: unknown[] = raw.blocks.map((b, idx) => {
    if (!b || typeof b !== 'object') return b;
    const blockObj = { ...(b as Record<string, unknown>) };
    if (typeof blockObj['blockId'] !== 'string' || blockObj['blockId'].trim() === '') {
      blockObj['blockId'] = `blk_${crypto.randomBytes(6).toString('hex')}`;
    }
    blockObj['sequence'] = idx + 1;

    // Also normalize child blocks for dashboard
    if (blockObj['type'] === 'dashboard' && Array.isArray(blockObj['blocks'])) {
      blockObj['blocks'] = blockObj['blocks'].map((child, cIdx) => {
        if (!child || typeof child !== 'object') return child;
        const childObj = { ...(child as Record<string, unknown>) };
        if (typeof childObj['blockId'] !== 'string' || childObj['blockId'].trim() === '') {
          childObj['blockId'] = `${blockObj['blockId']}_c${cIdx + 1}`;
        }
        childObj['sequence'] = cIdx + 1;
        return childObj;
      });
    }

    return blockObj;
  });

  const normalizedPayload = {
    schemaVersion: 1,
    blocks: normalizedBlocks,
  };

  const parsed = uiResponseV1Schema.safeParse(normalizedPayload);
  if (parsed.success) {
    return {
      ok: true,
      data: parsed.data,
    };
  }

  // Validation failed: extract sanitized safe textual fallback
  const fallback = extractSanitizedFallback(raw.blocks);
  return {
    ok: false,
    fallbackText: fallback,
    error: parsed.error.message,
  };
}

/**
 * Extracts a safe markdown/text fallback from an array of raw block definitions.
 * Never outputs executable tags or dangerous payloads.
 */
export function extractSanitizedFallback(blocks: unknown[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const type = typeof b['type'] === 'string' ? b['type'] : 'unknown';

    if (b['title'] && typeof b['title'] === 'string') {
      parts.push(`### ${sanitizeInertText(b['title'])}`);
    }

    switch (type) {
      case 'text': {
        if (typeof b['text'] === 'string') {
          parts.push(sanitizeInertText(b['text']));
        }
        break;
      }
      case 'metric': {
        const label = typeof b['label'] === 'string' ? sanitizeInertText(b['label']) : 'Metric';
        const val = b['value'] !== undefined ? sanitizeInertText(String(b['value'])) : '-';
        const unit = typeof b['unit'] === 'string' ? ` ${sanitizeInertText(b['unit'])}` : '';
        parts.push(`- **${label}**: ${val}${unit}`);
        break;
      }
      case 'table': {
        if (Array.isArray(b['columns']) && Array.isArray(b['rows'])) {
          const cols = b['columns']
            .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
            .map((c) => sanitizeInertText(String(c['label'] ?? c['key'] ?? '')));
          if (cols.length > 0) {
            parts.push(`| ${cols.join(' | ')} |`);
            parts.push(`| ${cols.map(() => '---').join(' | ')} |`);
            for (const r of b['rows'].slice(0, 10)) {
              if (!r || typeof r !== 'object') continue;
              const rowObj = r as Record<string, unknown>;
              const rowCells = b['columns'].map((c) => {
                const colKey = String((c as Record<string, unknown>)['key']);
                const cell = rowObj[colKey];
                if (cell && typeof cell === 'object' && 'display' in cell) {
                  return sanitizeInertText(String((cell as { display: unknown }).display));
                }
                return sanitizeInertText(String(cell ?? ''));
              });
              parts.push(`| ${rowCells.join(' | ')} |`);
            }
          }
        }
        break;
      }
      case 'steps': {
        if (Array.isArray(b['steps'])) {
          for (const s of b['steps']) {
            if (!s || typeof s !== 'object') continue;
            const stepObj = s as Record<string, unknown>;
            const idx = stepObj['index'] ?? '';
            const title = sanitizeInertText(String(stepObj['title'] ?? ''));
            const status = stepObj['status'] ? ` (${sanitizeInertText(String(stepObj['status']))})` : '';
            parts.push(`${idx}. **${title}**${status}`);
          }
        }
        break;
      }
      default: {
        // For other types, include simple sanitized description if present
        if (b['description'] && typeof b['description'] === 'string') {
          parts.push(sanitizeInertText(b['description']));
        }
        break;
      }
    }
  }

  if (parts.length === 0) {
    return 'Structured view could not be rendered.';
  }

  return parts.join('\n\n');
}
