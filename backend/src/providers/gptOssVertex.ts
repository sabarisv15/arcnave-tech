/**
 * Open-weight `gpt-oss` on Vertex, via the OpenAI-compatible chat-completions endpoint.
 *
 * A separate adapter rather than a branch inside the Gemini one, because it is a genuinely
 * different API shape: Vertex serves Model-as-a-Service open models over an OpenAI-compatible
 * `/chat/completions` path, not `generateContent`.
 *
 * This backs the composer alias formerly labelled "GPT 5 Terra". That label named a
 * proprietary OpenAI model which is not on Vertex at all; the alias now reads "GPT-OSS 120B"
 * so the UI names the model that actually answers. See docs/decisions/0002-model-aliases.md.
 *
 * No grounding: this endpoint exposes no Google Search tool, so `supportsGrounding` is false
 * and search/research modes route elsewhere.
 */
import { GoogleAuth } from 'google-auth-library';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { GenerationRequest, Provider, ProviderEvent, ProviderUsage } from './types.js';
import { EMPTY_USAGE, isAbort, ModelNotFoundError, ProviderError } from './types.js';

const log = logger.child({ module: 'provider:gpt-oss' });

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function endpointFor(project: string, location: string): string {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

export class GptOssVertexProvider implements Provider {
  readonly name = 'openai-oss';
  private auth: GoogleAuth | undefined;

  constructor(private readonly cfg: Config) {}

  supportsGrounding(): boolean {
    return false;
  }

  private async token(): Promise<string> {
    try {
      this.auth ??= new GoogleAuth({ scopes: [SCOPE] });
      const token = await this.auth.getAccessToken();
      if (!token) throw new Error('Application Default Credentials returned no access token');
      return token;
    } catch (err) {
      throw new ProviderError(`Could not obtain Google credentials: ${String(err)}`, {
        code: 'model_unavailable',
      });
    }
  }

  private url(): string {
    const project = this.cfg.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
    }
    return endpointFor(project, this.cfg.gptOssLocation);
  }

  private payload(request: GenerationRequest, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemInstruction) {
      messages.push({ role: 'system', content: request.systemInstruction });
    }
    for (const turn of request.history) {
      if (turn.text.trim() !== '') messages.push({ role: turn.role, content: turn.text });
    }
    messages.push({ role: 'user', content: request.prompt });

    return {
      model: request.providerModelId,
      messages,
      max_tokens: request.maxOutputTokens,
      stream,
      // gpt-oss exposes reasoning_effort (minimal..high). Medium is the balance a general
      // workspace wants; exposing it as a per-request knob is future work, not a default.
      reasoning_effort: 'medium',
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  private raiseForStatus(status: number, body: string, modelId: string): never {
    if (status === 404) throw new ModelNotFoundError(modelId, this.cfg.gptOssLocation);
    throw new ProviderError(`gpt-oss endpoint returned ${status}: ${body.slice(0, 300)}`, {
      retryable: RETRYABLE_STATUS.has(status),
      statusCode: status,
    });
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const token = await this.token();
    let usage = EMPTY_USAGE;
    let finishReason = 'stop';

    // Compose the caller's cancellation with our own timeout, so whichever fires first aborts
    // the real HTTP request rather than merely abandoning the read loop.
    const timeout = AbortSignal.timeout(this.cfg.PROVIDER_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, timeout]);

    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(this.payload(request, true)),
        signal,
      });
    } catch (err) {
      if (isAbort(err) && request.signal.aborted) throw err;
      if (isAbort(err)) {
        throw new ProviderError('gpt-oss request timed out', {
          retryable: true,
          code: 'provider_timeout',
        });
      }
      throw new ProviderError(`gpt-oss request failed: ${String(err)}`, { retryable: true });
    }

    if (!response.ok) {
      this.raiseForStatus(response.status, await response.text(), request.providerModelId);
    }
    if (!response.body) {
      throw new ProviderError('gpt-oss returned an empty response body', { retryable: true });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are newline-delimited; keep the trailing partial line in the buffer.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          let frame: ChatCompletionChunk;
          try {
            frame = JSON.parse(data) as ChatCompletionChunk;
          } catch {
            log.debug({ frame: data.slice(0, 200) }, 'gpt-oss sent an unparseable frame');
            continue;
          }

          for (const choice of frame.choices ?? []) {
            const content = choice.delta?.content;
            if (content) yield { type: 'delta', text: content };
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }

          if (frame.usage) {
            usage = {
              inputTokens: frame.usage.prompt_tokens ?? 0,
              outputTokens: frame.usage.completion_tokens ?? 0,
              cacheReadTokens: frame.usage.prompt_tokens_details?.cached_tokens ?? 0,
              cacheWriteTokens: 0,
              exact: true,
            };
          }
        }
      }
    } catch (err) {
      if (isAbort(err) || request.signal.aborted) throw err;
      throw new ProviderError(`gpt-oss stream failed: ${String(err)}`, { retryable: true });
    } finally {
      // Releasing the reader lets the socket close rather than leaking on early exit.
      await reader.cancel().catch(() => undefined);
    }

    yield { type: 'completed', usage, finishReason };
  }

  async probe(providerModelId: string, signal: AbortSignal): Promise<void> {
    const token = await this.token();
    const request: GenerationRequest = {
      prompt: 'ping',
      history: [],
      systemInstruction: '',
      mode: 'chat',
      maxOutputTokens: 1,
      providerModelId,
      grounded: false,
      codeExecution: false,
      signal,
    };
    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(this.payload(request, false)),
        signal,
      });
    } catch (err) {
      throw new ProviderError(String(err), { retryable: true });
    }
    if (!response.ok) {
      this.raiseForStatus(response.status, await response.text(), providerModelId);
    }
  }
}
