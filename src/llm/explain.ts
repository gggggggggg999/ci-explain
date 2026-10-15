import type { LlmSection } from '../core/schema.js';
import { LLM_ERROR_REASONS, LlmError, type LlmProvider } from './provider.js';
import { parseModelAnswer } from './sanitize-output.js';
import type { BuiltPrompt } from './prompt.js';

export const AI_NOTICE = 'AI-generated, may be wrong. Treat as untrusted text.';

/** Runs the AI layer. Never throws: any failure becomes `{ used: false, unavailableReason }`. */
export async function explainWithLlm(
  provider: LlmProvider,
  prompt: BuiltPrompt,
  options: { model: string; maxOutputTokens: number },
): Promise<LlmSection> {
  try {
    const content = await provider.complete({
      messages: prompt.messages,
      maxOutputTokens: options.maxOutputTokens,
    });
    const answer = parseModelAnswer(content);
    if (!answer) {
      return {
        used: false,
        provider: provider.name,
        model: options.model,
        unavailableReason: LLM_ERROR_REASONS['bad-response'],
      };
    }
    return {
      used: true,
      provider: provider.name,
      model: options.model,
      summary: answer.summary,
      ...(answer.likelyCause ? { likelyCause: answer.likelyCause } : {}),
      suggestions: answer.suggestions,
      notice: AI_NOTICE,
    };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'network';
    return {
      used: false,
      provider: provider.name,
      model: options.model,
      unavailableReason: LLM_ERROR_REASONS[kind],
    };
  }
}
