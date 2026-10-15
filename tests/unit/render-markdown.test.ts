import { describe, expect, it } from 'vitest';
import { renderMarkdown, escapeMarkdown, fence } from '../../src/cli/render-markdown.js';
import { analyzeLog } from '../../src/core/analyze.js';
import { buildReport } from '../../src/core/report.js';

const reportFor = (log: string) =>
  buildReport(analyzeLog(log), { toolVersion: '0.0.0-test', sourceKind: 'stdin' });

describe('escapeMarkdown', () => {
  it('neutralizes formatting, HTML, images, mentions, issue refs and autolinks', () => {
    const evil =
      '**bold** <img src=x onerror=1> ![i](http://e.test/a.png) @everyone fixes #123 https://e.test www.e.test';
    const out = escapeMarkdown(evil);
    expect(out).not.toMatch(/(?<!\\)</);
    expect(out).not.toContain('@everyone');
    expect(out).not.toMatch(/#123/);
    expect(out).not.toMatch(/https:\/\//);
    expect(out).not.toMatch(/www\./);
    expect(out).not.toContain('**bold**');
    expect(out).not.toMatch(/(?<!\\)!\[/);
  });

  it('escapes block-level markers at line starts', () => {
    expect(escapeMarkdown('# heading\n> quote\n- item')).toBe('\\# heading\n\\> quote\n\\- item');
  });
});

describe('fence', () => {
  it('uses a fence longer than any backtick run in the content', () => {
    const f = fence('a ```` b');
    expect(f.startsWith('`````\n')).toBe(true);
    expect(f.endsWith('\n`````')).toBe(true);
  });
});

describe('renderMarkdown', () => {
  it('keeps hostile log content from breaking out of the evidence block or pinging users', () => {
    const log = [
      '##[group]Run build',
      "Error: Cannot find module '@everyone/pkg'",
      '```',
      '@octocat please see #42 <script>alert(1)</script>',
      '##[error]Process completed with exit code 1.',
    ].join('\n');
    const md = renderMarkdown(reportFor(log));
    expect(md).toContain('## CI failure explanation');
    // Prose never contains a raw mention.
    const prose = md
      .split(/^(`{3,}).*$/m)
      .filter((_, i) => i % 3 === 0)
      .join('\n');
    expect(prose).not.toMatch(/@everyone/);
    // Every fence that is opened is closed (balanced).
    const fenceLines = md.split('\n').filter((l) => /^`{3,}$/.test(l));
    expect(fenceLines.length % 2).toBe(0);
  });

  it('truncates to the size limit and never leaves an open fence', () => {
    const body = Array.from(
      { length: 200 },
      (_, i) => `src/f${i}.ts(1,1): error TS2304: Cannot find name 'x'.`,
    );
    const md = renderMarkdown(reportFor(['##[group]Run tsc', ...body].join('\n')), {
      maxBytes: 400,
    });
    expect(Buffer.byteLength(md, 'utf8')).toBeLessThanOrEqual(400);
    expect(md).toContain('truncated');
    const opens = md.split('\n').filter((l) => /^`{3,}/.test(l)).length;
    expect(opens % 2).toBe(0);
  });

  it('states that suggestions were not executed', () => {
    const md = renderMarkdown(reportFor('Error: ENOSPC: no space left on device, write\n'));
    expect(md).toMatch(/not executed/);
  });
});

describe('renderMarkdown with AI section', () => {
  it('labels AI text, keeps suggestions in a fenced "not executed" block', () => {
    const base = reportFor('Error: ENOSPC: no space left on device, write\n');
    const md = renderMarkdown({
      ...base,
      llm: {
        used: true,
        provider: 'llm.example.test',
        summary: 'Disk is full (L1) @everyone',
        suggestions: ['rm -rf /tmp/cache'],
        notice: 'AI-generated, may be wrong.',
      },
    });
    expect(md).toContain('AI-generated, may be wrong');
    expect(md).toContain('suggestion, not executed');
    expect(md).not.toContain('@everyone');
    expect(md).toMatch(/```\n- rm -rf \/tmp\/cache\n```/);
  });
});
