export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  maxOutputTokens: number;
}

/**
 * Minimal provider interface. Providers get no tools and cannot act: they only turn messages into text.
 * Only one implementation exists (OpenAI-compatible chat completions); other providers are not promised.
 */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<string>;
}

export type LlmErrorKind =
  'config' | 'timeout' | 'rate-limit' | 'server' | 'auth' | 'network' | 'bad-response' | 'empty';

/** Error whose message is a fixed string: it never contains keys, headers, prompts or response bodies. */
export class LlmError extends Error {
  override name = 'LlmError';
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const LLM_ERROR_REASONS: Record<LlmErrorKind, string> = {
  config: 'the AI layer is misconfigured',
  timeout: 'the request timed out',
  'rate-limit': 'the provider rate-limited the request (HTTP 429) after retries',
  server: 'the provider returned a server error after retries',
  auth: 'the provider rejected the credentials (check the API key)',
  network: 'a network error occurred',
  'bad-response': 'the response was not in the expected shape and was discarded',
  empty: 'the provider returned an empty response',
};
