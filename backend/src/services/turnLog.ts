/**
 * A Markdown record of one reply (ADR-0050): the model that answered, what the request carried
 * (a PDF's page images included), the tools and skills on offer, and every step the model took
 * with its input and result. Kept so what a reply did is read, not guessed.
 *
 * The system prompt's text is not written out, only its size and sections: the log is shown to
 * the person who sent the message.
 */
import type { AttachmentBlock, GenerationRequest, ToolResult, Turn } from '../providers/types.js';

/** Tool inputs and results longer than this are cut in the log, with the cut said. */
const MAX_BLOCK_CHARS = 6_000;

function clip(text: string, max = MAX_BLOCK_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n… [${String(text.length - max)} more characters not shown]` : text;
}

/** A fenced block whose fence no line of the text can close. */
function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** How one attachment went to the model, in one line. */
export function describeSentAttachment(a: AttachmentBlock): string {
  const name = `"${a.filename ?? a.id ?? 'attachment'}" (${a.mimeType})`;
  if (a.pages) {
    const images = a.pages.filter((p) => p.image?.fileUri || p.image?.base64);
    const byUri = images.filter((p) => p.image?.fileUri).length;
    const inlineBytes = images.reduce((n, p) => n + (p.image?.base64 ? Buffer.byteLength(p.image.base64, 'utf8') : 0), 0);
    const withText = a.pages.filter((p) => p.text.trim() !== '').length;
    const how = [
      byUri ? `${String(byUri)} by Cloud Storage URI` : '',
      images.length - byUri ? `${String(images.length - byUri)} inline (${kb(inlineBytes)} base64)` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return (
      `${name}: ${String(a.pages.length)} pages, ${String(images.length)} page images sent` +
      (how ? ` (${how})` : '') +
      `; a text layer on ${String(withText)} of ${String(a.pages.length)}`
    );
  }
  if (a.omittedReason) {
    return `${name}: not sent (${a.omittedReason}${a.omittedDetail ? `: ${a.omittedDetail}` : ''})` +
      (a.extractedText ? `; its extracted text went instead (${String(a.extractedText.length)} characters)` : '');
  }
  if (a.textOnlyPageCount) {
    return `${name}: text only, ${String(a.textOnlyPageCount)} pages (${String(a.extractedText?.length ?? 0)} characters)`;
  }
  if (a.base64) return `${name}: sent as bytes (${kb(Buffer.byteLength(a.base64, 'utf8'))} base64)`;
  if (a.extractedText) return `${name}: sent as text (${String(a.extractedText.length)} characters)`;
  return `${name}: nothing of it in the request`;
}

/** The top-level sections of a system prompt, by their tags. */
function promptSections(system: string): string[] {
  return [...system.matchAll(/^<([a-zA-Z_]+)>$/gm)].map((m) => m[1]!);
}

function resultText(result: ToolResult): string {
  return result.content
    .map((c) =>
      c.type === 'text'
        ? c.text
        : c.type === 'json'
          ? JSON.stringify(c.data, null, 2)
          : c.type === 'image'
            ? `[image shown to the model: ${c.name}, ${c.mimeType}, ${kb(Buffer.byteLength(c.base64, 'utf8'))} base64]`
            : `[${(c as { type: string }).type}]`,
    )
    .join('\n');
}

export interface TurnLogHeader {
  messageId: string;
  chatId: string;
  startedAt: Date;
  requested: string;
  resolved: string;
  providerModelId: string;
  grounded: boolean;
  effort?: string;
  clientPlatform?: string;
}

type Step =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'call'; id: string; name: string; input: unknown; result?: ToolResult; at: number };

export class TurnLog {
  private readonly started = Date.now();
  private request?: { lines: string[] };
  private readonly steps: Step[] = [];
  private end?: string[];

  constructor(private readonly header: TurnLogHeader) {}

  /** What was sent: the prompt's shape, the attachments as they went, the tools and skills. */
  sent(request: GenerationRequest, skills: string[]): void {
    const lines: string[] = [];
    const system = request.systemInstruction ?? '';
    lines.push(`- System prompt: ${String(system.length)} characters; sections: ${promptSections(system).join(', ') || '(none)'}`);
    lines.push(`- Earlier turns in the request: ${String(request.history.length)}`);
    lines.push(`- Tools declared (${String(request.tools?.length ?? 0)}): ${(request.tools ?? []).map((t) => t.name).join(', ') || 'none'}`);
    if (request.grounded) lines.push('- Built-in web search: on');
    lines.push(`- Skills listed: ${skills.join(', ') || 'none'}`);
    lines.push('', '**Attachments of this message**', '');
    lines.push(...(request.attachments?.length ? request.attachments.map((a) => `- ${describeSentAttachment(a)}`) : ['- none']));
    const earlier = request.history.flatMap((t: Turn) => t.attachments ?? []);
    if (earlier.length) {
      lines.push('', '**Attachments carried from earlier turns**', '');
      lines.push(...earlier.map((a) => `- ${describeSentAttachment(a)}`));
    }
    lines.push('', '**The user message as sent**', '', fence(clip(request.prompt)));
    this.request = { lines };
  }

  thinking(text: string): void {
    this.append('thinking', text);
  }

  text(text: string): void {
    this.append('text', text);
  }

  call(id: string, name: string, input: unknown): void {
    this.steps.push({ kind: 'call', id, name, input, at: Date.now() - this.started });
  }

  result(id: string, result: ToolResult): void {
    const step = this.steps.find((s) => s.kind === 'call' && s.id === id);
    if (step?.kind === 'call') step.result = result;
  }

  finish(outcome: { status: string; finishReason?: string | null; errorCode?: string | null; usage?: object; timing?: object }): void {
    const lines = [`- Status: ${outcome.status}`];
    if (outcome.finishReason) lines.push(`- Finish reason: ${outcome.finishReason}`);
    if (outcome.errorCode) lines.push(`- Error: ${outcome.errorCode}`);
    if (outcome.usage) lines.push(`- Usage: \`${JSON.stringify(outcome.usage)}\``);
    if (outcome.timing) lines.push(`- Timing: \`${JSON.stringify(outcome.timing)}\``);
    lines.push(`- Took: ${((Date.now() - this.started) / 1000).toFixed(1)} s`);
    this.end = lines;
  }

  markdown(): string {
    const h = this.header;
    const out = [
      `# Turn log ${h.messageId}`,
      '',
      `- Chat: ${h.chatId}`,
      `- Started: ${h.startedAt.toISOString()}`,
      `- Model: ${h.resolved} (${h.providerModelId})${h.requested !== h.resolved ? `, asked for ${h.requested}` : ''}`,
      ...(h.effort ? [`- Effort: ${h.effort}`] : []),
      ...(h.clientPlatform ? [`- Client: ${h.clientPlatform}`] : []),
      '',
      '## What was sent',
      '',
      ...(this.request?.lines ?? ['(the turn ended before a request was sent)']),
      '',
      '## What the model did',
      '',
    ];
    const calls = this.steps.filter((s) => s.kind === 'call').length;
    out.push(`${String(calls)} tool call${calls === 1 ? '' : 's'}.`, '');
    let n = 0;
    for (const s of this.steps) {
      if (s.kind === 'thinking') out.push('**Thinking**', '', fence(clip(s.text)), '');
      else if (s.kind === 'text') out.push('**Reply text**', '', fence(clip(s.text)), '');
      else {
        n += 1;
        out.push(`### ${String(n)}. ${s.name} (at ${(s.at / 1000).toFixed(1)} s)`, '', 'Input:', '', fence(clip(JSON.stringify(s.input, null, 2)), 'json'), '');
        if (s.result) out.push(`Result (${s.result.ok ? 'ok' : 'failed'}):`, '', fence(clip(resultText(s.result))), '');
        else out.push('Result: none (the turn ended before it came back)', '');
      }
    }
    out.push('## Outcome', '', ...(this.end ?? ['- Status: unfinished']), '');
    return out.join('\n');
  }

  private append(kind: 'thinking' | 'text', text: string): void {
    const last = this.steps.at(-1);
    if (last && last.kind === kind) last.text += text;
    else this.steps.push({ kind, text });
  }
}
