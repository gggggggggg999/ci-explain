import { z } from 'zod';

const ZWSP = '\u200b';
const MAX_SUMMARY = 1200;
const MAX_CAUSE = 400;
const MAX_SUGGESTION = 300;

const ModelAnswerSchema = z.object({
  summary: z.string().min(1),
  likelyCause: z.string().optional(),
  suggestions: z.array(z.string()).max(10).optional(),
});

export interface SanitizedAnswer {
  summary: string;
  likelyCause?: string;
  suggestions: string[];
}

/** Cleans untrusted model text: no HTML, images, links, control characters, mentions or issue refs. */
export function sanitizeModelText(input: string, maxLength: number): string {
  let t = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/<[^>]{0,500}>/g, '')
    .replace(/!\[[^\]]{0,300}\]\([^)]{0,500}\)/g, '')
    .replace(/\[([^\]]{1,300})\]\([^)]{0,500}\)/g, '$1')
    .replace(/\b(?:https?|ftp):\/\/\S{1,500}/gi, '[link removed]')
    .replace(/\bwww\.\S{1,200}/gi, '[link removed]')
    .replace(/@(?!\u200b)/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (t.length > maxLength) t = t.slice(0, maxLength).trimEnd() + '…';
  return t;
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]{0,100000}?)\n```$/i.exec(trimmed);
  const candidate = fenced ? (fenced[1] ?? '') : trimmed;
  return JSON.parse(candidate);
}

/** Returns null when the model output does not match the required JSON shape (it is then discarded). */
export function parseModelAnswer(content: string): SanitizedAnswer | null {
  let json: unknown;
  try {
    json = extractJson(content);
  } catch {
    return null;
  }
  const parsed = ModelAnswerSchema.safeParse(json);
  if (!parsed.success) return null;
  const summary = sanitizeModelText(parsed.data.summary, MAX_SUMMARY);
  if (summary === '') return null;
  const likelyCause = parsed.data.likelyCause
    ? sanitizeModelText(parsed.data.likelyCause, MAX_CAUSE)
    : undefined;
  const suggestions = (parsed.data.suggestions ?? [])
    .slice(0, 3)
    .map((s) => sanitizeModelText(s, MAX_SUGGESTION))
    .filter((s) => s !== '');
  return { summary, ...(likelyCause ? { likelyCause } : {}), suggestions };
}
