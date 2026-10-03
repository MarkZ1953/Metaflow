import { describe, expect, it } from 'vitest';
import {
  allowedDuplicateShortcut,
  currentDuplicateRemoval,
  duplicateRemovalTarget,
  type DuplicateShortcutContext,
} from './duplicate-shortcuts';
import type { DuplicateComparison } from './duplicate-service';

const pair: DuplicateComparison = {
  id: 'pair-a',
  kind: 'similar',
  left: {
    path: 'F:/Fotos/izquierda.jpg',
    hash: 'left-content',
    planned: false,
    stamp: { size: 100, createdAt: 1, modifiedAt: 2 },
  },
  right: {
    path: 'F:/Fotos/derecha.jpg',
    hash: 'right-content',
    planned: false,
    stamp: { size: 110, createdAt: 1, modifiedAt: 3 },
  },
};
const ready: DuplicateShortcutContext = {
  active: true,
  busy: false,
  scanning: false,
  externalDialog: false,
  hasComparison: true,
  canRemove: true,
  canGoBack: true,
  hasUndo: true,
  confirming: false,
  confirmationCurrent: false,
};

describe('Duplicate review shortcuts', () => {
  it('opens removal only after previews are ready and confirmation is a separate action', () => {
    expect(allowedDuplicateShortcut('remove', ready)).toBe('remove');
    expect(allowedDuplicateShortcut('confirm', ready)).toBeNull();
    expect(allowedDuplicateShortcut('remove', { ...ready, canRemove: false })).toBeNull();
    expect(allowedDuplicateShortcut('next', { ...ready, canRemove: false })).toBe('next');
  });

  it('pauses selection, navigation, dismissal and undo while a removal is being confirmed', () => {
    const confirming = { ...ready, confirming: true, confirmationCurrent: true };
    for (const action of [
      'previous',
      'next',
      'left',
      'right',
      'remove',
      'keep',
      'discard',
      'undo',
    ] as const)
      expect(allowedDuplicateShortcut(action, confirming)).toBeNull();
    expect(allowedDuplicateShortcut('confirm', confirming)).toBe('confirm');
    expect(
      allowedDuplicateShortcut('confirm', { ...confirming, confirmationCurrent: false }),
    ).toBeNull();
  });

  it('ignores every action during background work, on another page or in an external dialog', () => {
    for (const context of [
      { ...ready, busy: true },
      { ...ready, scanning: true },
      { ...ready, active: false },
      { ...ready, externalDialog: true },
    ]) {
      for (const action of [
        'previous',
        'next',
        'remove',
        'confirm',
        'keep',
        'discard',
        'undo',
        'left',
        'right',
      ] as const)
        expect(allowedDuplicateShortcut(action, context)).toBeNull();
    }
  });

  it('allows returning or undoing from the completed review without deleting an absent comparison', () => {
    const completed = { ...ready, hasComparison: false };
    expect(allowedDuplicateShortcut('previous', completed)).toBe('previous');
    expect(allowedDuplicateShortcut('undo', completed)).toBe('undo');
    for (const action of ['next', 'remove', 'keep', 'discard', 'left', 'right'] as const)
      expect(allowedDuplicateShortcut(action, completed)).toBeNull();
    expect(allowedDuplicateShortcut('previous', { ...completed, canGoBack: false })).toBeNull();
    expect(allowedDuplicateShortcut('undo', { ...completed, hasUndo: false })).toBeNull();
  });

  it('captures exactly the selected side and the copy that remains', () => {
    const target = duplicateRemovalTarget('session-a', pair, 'left');
    expect(target.file.path).toBe(pair.left.path);
    expect(target.keeper.path).toBe(pair.right.path);
    expect(target.file).not.toBe(pair.left);
    expect(target.file.stamp).not.toBe(pair.left.stamp);
    expect(currentDuplicateRemoval(target, 'session-a', pair)).toBe(true);
  });

  it('rejects confirmation after a rescan, navigation, changed selected file or changed keeper', () => {
    const target = duplicateRemovalTarget('session-a', pair, 'right');
    expect(currentDuplicateRemoval(target, 'session-b', pair)).toBe(false);
    expect(currentDuplicateRemoval(target, 'session-a', { ...pair, id: 'pair-b' })).toBe(false);
    expect(currentDuplicateRemoval(target, 'session-a', undefined)).toBe(false);
    expect(
      currentDuplicateRemoval(target, 'session-a', {
        ...pair,
        right: { ...pair.right, path: 'F:/Fotos/otra.jpg' },
      }),
    ).toBe(false);
    expect(
      currentDuplicateRemoval(target, 'session-a', {
        ...pair,
        left: { ...pair.left, hash: 'changed' },
      }),
    ).toBe(false);
    expect(
      currentDuplicateRemoval(target, 'session-a', {
        ...pair,
        right: { ...pair.right, stamp: { ...pair.right.stamp, modifiedAt: 4 } },
      }),
    ).toBe(false);
  });
});
