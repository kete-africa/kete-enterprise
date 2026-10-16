import { describe, expect, it } from 'vitest';
import { encode, fromStored, noExtras, plainOf, translator } from '../src/lib/intelligence-stream';
import type { DraftReview, StoredMessage } from '../src/lib/workspace';

// Spec 085: the center's stream told as Kete Intelligence's contract, without a screen.

describe('what she cites and asks', () => {
  it('writes her picks as the directives the center reads', () => {
    const said = encode('Demande à @Kossi Adjo de /résumer', [
      { kind: 'mention', id: 'person:usr_1', label: 'Kossi Adjo' },
      { kind: 'gesture', id: 'summarize', label: 'résumer' },
    ]);
    expect(said).toBe(
      'Demande à :person[Kossi Adjo]{name=usr_1} de :command[résumer]{name=summarize}',
    );
  });

  it('reads the directives back as she wrote them', () => {
    expect(plainOf(':person[Kossi Adjo]{name=usr_1}, :command[résumer]{name=summarize}')).toBe(
      '@Kossi Adjo, /résumer',
    );
  });
});

describe('a thread opened again', () => {
  const draft = { draftId: 'drf_1', description: 'Relancer le client' } as DraftReview;
  const messages = [
    { messageId: 'm1', role: 'user', content: 'Où en est :app[KYA]{name=res_1} ?' },
    {
      messageId: 'm2',
      role: 'assistant',
      content: 'Deux tâches restent.',
      tools: [
        { name: 'list_tasks', state: 'done' },
        { name: 'send_mail', state: 'refused' },
      ],
      drafts: [draft],
      sources: [{ label: 'Projet KYA', href: '/projets/kya' }],
      canvas: { title: 'Note', content: '…' },
    },
  ] as unknown as StoredMessage[];

  it('gives its answered turns, their drafts and their extras', () => {
    const { turns, extras, drafts } = fromStored(messages, 'cnv_1');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ question: 'Où en est @KYA ?', state: 'done' });
    expect(turns[0]?.text).toBe('Deux tâches restent.');
    expect(turns[0]?.tools.map((tool) => tool.state)).toEqual(['done', 'failed']);
    expect(turns[0]?.drafts).toEqual([{ id: 'drf_1', title: 'Relancer le client' }]);
    expect(drafts).toEqual({ drf_1: draft });
    expect(extras[0]).toMatchObject({ conversationId: 'cnv_1', canvas: { title: 'Note' } });
  });
});

describe('one answer told as the contract', () => {
  it('tells words, gestures and drafts, then the tally of the gestures done', () => {
    let now = 1_000;
    const translate = translator(1_000, () => now);
    expect(translate({ type: 'text', delta: 'Bonjour' }).lines).toEqual([
      { type: 'text', delta: 'Bonjour' },
    ]);
    expect(
      translate({ type: 'tool', id: 't1', name: 'list_tasks', state: 'running' }).lines,
    ).toEqual([{ type: 'tool', id: 't1', name: 'list_tasks', level: 1, state: 'running' }]);
    const drafted = translate({
      type: 'tool',
      id: 't1',
      name: 'list_tasks',
      level: 2,
      state: 'done',
      input: 'KYA',
      draft: { draftId: 'drf_1', description: 'Relancer' },
    });
    expect(drafted.lines).toEqual([
      { type: 'tool', id: 't1', name: 'list_tasks', level: 2, state: 'done', input: 'KYA' },
      { type: 'draft', draft_id: 'drf_1', title: 'Relancer' },
    ]);
    expect(drafted.draft?.draftId).toBe('drf_1');
    expect(
      translate({ type: 'tool', id: 't2', name: 'send_mail', state: 'refused' }).lines,
    ).toEqual([{ type: 'tool', id: 't2', name: 'send_mail', level: 1, state: 'failed' }]);
    now = 3_500;
    expect(translate({ type: 'done' }).lines).toEqual([{ type: 'done', tools: 2, ms: 2_500 }]);
  });

  it('keeps aside what the contract does not carry', () => {
    const translate = translator(0);
    const opened = translate({ type: 'conversation', conversationId: 'cnv_2' });
    expect(opened.conversationId).toBe('cnv_2');
    let extra = opened.extra?.(noExtras(null)) ?? noExtras(null);
    extra = translate({ type: 'table', title: 'Tâches' }).extra?.(extra) ?? extra;
    extra = translate({ type: 'canvas', title: 'Note', content: 'texte' }).extra?.(extra) ?? extra;
    expect(extra).toMatchObject({
      conversationId: 'cnv_2',
      tables: [{ type: 'table', title: 'Tâches' }],
      canvas: { title: 'Note', content: 'texte' },
    });
  });

  it('tells a refusal by its code, and ignores what it does not know', () => {
    const translate = translator(0);
    expect(translate({ type: 'error', code: 'quota_reached' }).lines).toEqual([
      { type: 'failed', reason: 'quota_reached' },
    ]);
    expect(translate({ type: 'error' }).lines).toEqual([
      { type: 'failed', reason: 'model_failed' },
    ]);
    expect(translate({ type: 'heartbeat' }).lines).toEqual([]);
  });
});
