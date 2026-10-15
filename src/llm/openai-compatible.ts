import { z } from 'zod';
import { LlmError, type LlmCompletionRequest, type LlmProvider } from './provider.js';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** `max_completion_tokens` is OpenAI's current name; some compatible servers only know `max_tokens`. */
  tokenParam?: 'max_completion_tokens' | 'max_tokens';
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RESPONSE_CHARS = 1_000_000;

const ResponseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Validates the user-supplied base URL (SSRF/credential-leak guard) and returns the chat endpoint. */
export function resolveEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LlmError('config', 'The LLM base URL is not a valid URL.');
  }
  if (url.username || url.password) {
    throw new LlmError('config', 'The LLM base URL must not contain credentials.');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LlmError(
      'config',
      'The LLM base URL must use https (http is allowed only for localhost).',
    );
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  return url;
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const endpoint = resolveEndpoint(config.baseUrl);
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = config.timeoutMs ?? 30_000;
  const maxRetries = config.maxRetries ?? 2;
  const tokenParam = config.tokenParam ?? 'max_completion_tokens';

  return {
    name: endpoint.host,
    async complete(request: LlmCompletionRequest): Promise<string> {
      const body = JSON.stringify({
        model: config.model,
        messages: request.messages,
        [tokenParam]: request.maxOutputTokens,
      });

      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body,
            // Never follow redirects: the API key must only ever go to the configured host.
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          const name = (err as { name?: string }).name;
          if (name === 'TimeoutError' || name === 'AbortError') {
            throw new LlmError('timeout', 'The LLM request timed out.');
          }
          if (attempt < maxRetries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new LlmError('network', 'Network error while contacting the LLM provider.');
        }

        if (response.status === 401 || response.status === 403) {
          throw new LlmError(
            'auth',
            `The LLM provider rejected the credentials (HTTP ${response.status}).`,
          );
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt < maxRetries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new LlmError(
            response.status === 429 ? 'rate-limit' : 'server',
            `The LLM provider kept failing (HTTP ${response.status}).`,
          );
        }
        if (!response.ok) {
          throw new LlmError(
            'bad-response',
            `Unexpected HTTP ${response.status} from the LLM provider.`,
          );
        }

        let raw: string;
        try {
          raw = await response.text();
        } catch {
          throw new LlmError('network', 'Network error while reading the LLM response.');
        }
        if (raw.length > MAX_RESPONSE_CHARS) {
          throw new LlmError('bad-response', 'The LLM response was too large.');
        }
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new LlmError('bad-response', 'The LLM response was not valid JSON.');
        }
        const parsed = ResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new LlmError('bad-response', 'The LLM response had an unexpected shape.');
        }
        const content = parsed.data.choices[0]?.message.content ?? '';
        if (content.trim() === '')
          throw new LlmError('empty', 'The LLM returned an empty response.');
        return content;
      }
    },
  };
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 4000);
}
