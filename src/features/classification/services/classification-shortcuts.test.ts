import { describe, expect, it } from 'vitest';
import { classificationShortcut } from './classification-shortcuts';
import type { MediaEntry } from './classification-service';

function entry(id: string, protectedFile = false): MediaEntry {
  return {
    id,
    name: `${id}.jpg`,
    path: `F:\\Fotos\\${id}.jpg`,
    stamp: { size: 10, modifiedAt: null, createdAt: null },
    kind: 'image',
    labels: [{ category: 'people', score: 0.3 }],
    protected: protectedFile,
    uncertain: false,
    status: 'classified',
    error: null,
  };
}

const entries = [entry('a'), entry('b', true), entry('c')];
const context = {
  busy: false,
  sessionId: 'scan-1',
  removal: null,
  entries,
  visible: entries,
  selected: [] as string[],
  excluded: [] as string[],
  activeId: null,
  lastOperationId: null,
};

describe('Keyboard decisions in the classification gallery and review', () => {
  it('allows review of explicitly selected exclusions while blocking Supr until they are included again', () => {
    const excluded = { ...context, selected: ['a', 'c'], excluded: ['a'] };
    expect(classificationShortcut('confirm', excluded)).toEqual({ type: 'open', id: 'a' });
    expect(classificationShortcut('remove', excluded)).toEqual({ type: 'remove', ids: ['c'] });
    expect(classificationShortcut('remove', { ...excluded, activeId: 'a' })).toBeNull();
    expect(
      classificationShortcut('confirm', {
        ...excluded,
        removal: { sessionId: 'scan-1', ids: ['a'] },
      }),
    ).toBeNull();
  });
  it('does not choose or retire any gallery file without an explicit selection', () => {
    expect(classificationShortcut('remove', context)).toBeNull();
    expect(classificationShortcut('confirm', context)).toBeNull();
    expect(classificationShortcut('keep', context)).toBeNull();
  });

  it('opens a removal confirmation only for valid unprotected selections', () => {
    const chosen = { ...context, selected: ['missing', 'b', 'c'] };
    expect(classificationShortcut('remove', chosen)).toEqual({ type: 'remove', ids: ['c'] });
    expect(classificationShortcut('remove', { ...chosen, selected: ['b'] })).toBeNull();
  });

  it('opens the first visible selected file when filters hide another selected file', () => {
    expect(
      classificationShortcut('confirm', {
        ...context,
        selected: ['a', 'c'],
        visible: [entries[2]!],
      }),
    ).toEqual({ type: 'open', id: 'c' });
    expect(classificationShortcut('confirm', { ...context, selected: ['c'], visible: [] })).toEqual(
      {
        type: 'open',
        id: 'c',
      },
    );
  });

  it('review removal targets only the displayed file and respects Conservar', () => {
    const reviewing = { ...context, selected: ['c'], activeId: 'a' };
    expect(classificationShortcut('remove', reviewing)).toEqual({ type: 'remove', ids: ['a'] });
    expect(classificationShortcut('remove', { ...reviewing, activeId: 'b' })).toBeNull();
    expect(classificationShortcut('confirm', reviewing)).toBeNull();
  });

  it('keeps the displayed file and advances, while a gallery decision keeps its explicit selection', () => {
    expect(classificationShortcut('keep', { ...context, activeId: 'a', selected: ['c'] })).toEqual({
      type: 'keep',
      ids: ['a'],
      advance: true,
    });
    expect(classificationShortcut('keep', { ...context, selected: ['missing', 'c', 'a'] })).toEqual(
      {
        type: 'keep',
        ids: ['a', 'c'],
        advance: false,
      },
    );
  });

  it('navigates the filtered review without wrapping or opening another hidden file', () => {
    const reviewing = { ...context, activeId: 'a', visible: [entries[0]!, entries[2]!] };
    expect(classificationShortcut('previous', reviewing)).toBeNull();
    expect(classificationShortcut('next', reviewing)).toEqual({ type: 'navigate', direction: 1 });
    expect(classificationShortcut('previous', { ...reviewing, activeId: 'c' })).toEqual({
      type: 'navigate',
      direction: -1,
    });
    expect(classificationShortcut('next', { ...reviewing, activeId: 'c' })).toBeNull();
    expect(classificationShortcut('next', { ...reviewing, activeId: 'b' })).toBeNull();
  });

  it('confirmation ignores navigation, Supr, Conservar and Undo beneath the open dialog', () => {
    const confirming = {
      ...context,
      activeId: 'a',
      lastOperationId: 'operation-1',
      removal: { sessionId: 'scan-1', ids: ['a'] },
    };
    for (const action of ['previous', 'next', 'remove', 'keep', 'undo'] as const)
      expect(classificationShortcut(action, confirming)).toBeNull();
    expect(classificationShortcut('confirm', confirming)).toEqual({ type: 'confirm-removal' });
  });

  it('does not confirm stale sessions, missing entries or files protected while awaiting a decision', () => {
    const confirming = { ...context, removal: { sessionId: 'scan-1', ids: ['a'] } };
    expect(classificationShortcut('confirm', { ...confirming, sessionId: 'scan-2' })).toBeNull();
    expect(classificationShortcut('confirm', { ...confirming, entries: [] })).toBeNull();
    expect(
      classificationShortcut('confirm', { ...confirming, entries: [entry('a', true)] }),
    ).toBeNull();
    expect(classificationShortcut('confirm', { ...confirming, busy: true })).toBeNull();
  });

  it('offers Undo only when a recent removal exists and nothing is busy', () => {
    expect(classificationShortcut('undo', context)).toBeNull();
    expect(
      classificationShortcut('undo', {
        ...context,
        sessionId: null,
        lastOperationId: 'operation-1',
      }),
    ).toEqual({ type: 'undo' });
    expect(
      classificationShortcut('undo', { ...context, busy: true, lastOperationId: 'operation-1' }),
    ).toBeNull();
  });

  it('disables destructive and keep actions if the scan is absent or another operation has begun', () => {
    const reviewing = { ...context, activeId: 'a', selected: ['c'] };
    for (const action of ['remove', 'keep', 'next', 'confirm'] as const) {
      expect(classificationShortcut(action, { ...reviewing, busy: true })).toBeNull();
      expect(classificationShortcut(action, { ...reviewing, sessionId: null })).toBeNull();
    }
  });
});
