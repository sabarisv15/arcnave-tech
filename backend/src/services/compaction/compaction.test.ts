import { describe, expect, it } from 'vitest';
import { compactionService } from './compactionService.js';
import { compactionSummarySchema, type CompactionSummary } from './types.js';

describe('Phase 5.3 Conversation Compaction', () => {
  it('triggers compaction when headroom falls below threshold', () => {
    // 32K context window, 25K tokens used => headroom = 32768 - 25000 - 4096 - 2048 = 1624 <= 8192
    const check = compactionService.checkTrigger(32768, 25000, 4096, 2048, true);
    expect(check.shouldCompact).toBe(true);
    expect(check.headroomTokens).toBe(1624);
    expect(check.reason).toContain('Headroom');
  });

  it('does not trigger compaction when ample headroom exists', () => {
    // 128K context window, 10K tokens used => headroom = 128000 - 10000 - 4096 - 2048 = 111856
    const check = compactionService.checkTrigger(128000, 10000);
    expect(check.shouldCompact).toBe(false);
    expect(check.headroomTokens).toBe(111856);
  });

  it('validates 11-field structured compaction schema', () => {
    const validSummary: CompactionSummary = {
      priorSummaryFolded: false,
      conversationTopic: 'Financial Dashboard Architecture',
      userExplicitPreferences: ['TypeScript strict mode', 'Dark theme'],
      establishedConstraints: ['No external CDN scripts', 'WCAG AA compliance'],
      artifactsCreatedOrModified: [
        {
          artifactId: 'art-123',
          title: 'Architecture Spec',
          kind: 'markdown',
          version: 1,
        },
      ],
      activeGoalsAndState: [
        {
          description: 'Implement financial dashboard',
          status: 'in_progress',
          note: 'Step 2 completed',
        },
      ],
      keyFactualDiscoveries: ['Postgres GIN index is available', 'Vertex AI supports caching'],
      pendingUserRequests: ['Add export to CSV'],
      openTasksAndNextSteps: ['Implement export button', 'Verify color contrast'],
      userDirectivesContinuity: ['Never truncate tables without user consent'],
      criticalContextNotes: 'Client presentation scheduled for next week.',
    };

    const parsed = compactionSummarySchema.parse(validSummary);
    expect(parsed.conversationTopic).toBe('Financial Dashboard Architecture');
    expect(parsed.artifactsCreatedOrModified).toHaveLength(1);
    expect(parsed.activeGoalsAndState).toHaveLength(1);
  });

  it('formats compaction into XML context for prompt injection', () => {
    const dummyCompaction = {
      id: 'comp-1',
      chatId: 'chat-1',
      throughMessageId: 'msg-10',
      throughSeq: 10,
      summary: {
        priorSummaryFolded: true,
        conversationTopic: 'Doc Exporter Implementation',
        userExplicitPreferences: ['Prefer DOCX and XLSX'],
        establishedConstraints: ['Node.js standard library'],
        artifactsCreatedOrModified: [],
        activeGoalsAndState: [],
        keyFactualDiscoveries: [],
        pendingUserRequests: [],
        openTasksAndNextSteps: ['Test with Excel 2021'],
        userDirectivesContinuity: [],
        criticalContextNotes: 'All formats verified',
      },
      tokenCountBefore: 12000,
      tokenCountAfter: 1500,
      provider: 'google',
      model: 'gemini-3.8-flash',
      createdAt: new Date(),
    };

    const formatted = compactionService.formatCompactionForPrompt(dummyCompaction);
    expect(formatted).toContain('<conversation_compaction through_message_id="msg-10" through_seq="10">');
    expect(formatted).toContain('Topic: Doc Exporter Implementation');
    expect(formatted).toContain('Prefer DOCX and XLSX');
    expect(formatted).toContain('Test with Excel 2021');
    expect(formatted).toContain('Critical Context Notes: All formats verified');
    expect(formatted).toContain('</conversation_compaction>');
  });
});

describe('summaryIn: the summary out of the model answer (ADR-0069)', () => {
  it('takes the first complete <summary> block, trimmed, and nothing when there is none', async () => {
    const { summaryIn } = await import('./autoCompact.js');
    expect(summaryIn('thinking…\n<summary>\n Facts: 4200.\n</summary> trailing')).toBe('Facts: 4200.');
    expect(summaryIn('<summary>first</summary><summary>second</summary>')).toBe('first');
    expect(summaryIn('<summary>a <summary>b</summary>')).toBe('a <summary>b');
    expect(summaryIn('<summary>never closed')).toBe('');
    expect(summaryIn('no tags')).toBe('');
  });

  it('is linear: 1 MB of unclosed <summary> takes well under a second', async () => {
    const { summaryIn } = await import('./autoCompact.js');
    const text = '<summary>'.repeat(Math.ceil((1024 * 1024) / 9));
    const started = performance.now();
    expect(summaryIn(text)).toBe('');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('compactionTrigger (ADR-0027)', () => {
  it('compacts as the window fills, at 967,000 on a 1M window as Claude Code does', async () => {
    const { compactionTrigger } = await import('./autoCompact.js');
    expect(compactionTrigger(150_000, 1_000_000)).toBe(967_000);
    expect(compactionTrigger(150_000, 200_000)).toBe(167_000);
  });

  it('uses the configured value only when the window is unknown, and never goes below 50,000', async () => {
    const { compactionTrigger } = await import('./autoCompact.js');
    expect(compactionTrigger(150_000, null)).toBe(150_000);
    expect(compactionTrigger(150_000, 60_000)).toBe(50_000);
  });
});
