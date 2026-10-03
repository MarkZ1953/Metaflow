import { describe, expect, it } from 'vitest';
import { preventRepeatedReviewActivation, resolveReviewShortcut } from './review-shortcuts';

describe('Review keyboard shortcuts', () => {
  it('blocks held Enter from activating subsequent native buttons after a confirmation closes', () => {
    expect(
      preventRepeatedReviewActivation({ key: 'Enter', repeat: true }, { nativeEnter: true }),
    ).toBe(true);
    expect(preventRepeatedReviewActivation({ key: 'Enter' }, { nativeEnter: true })).toBe(false);
    expect(
      preventRepeatedReviewActivation(
        { key: 'Enter', repeat: true },
        { nativeEnter: true, editing: true },
      ),
    ).toBe(false);
    expect(
      preventRepeatedReviewActivation({ key: 'Delete', repeat: true }, { nativeEnter: true }),
    ).toBe(false);
  });
  it('supports navigation, selected-file deletion and explicit decisions', () => {
    expect(resolveReviewShortcut({ key: 'ArrowLeft' })).toBe('previous');
    expect(resolveReviewShortcut({ key: 'ArrowRight' })).toBe('next');
    expect(resolveReviewShortcut({ key: 'Delete' })).toBe('remove');
    expect(resolveReviewShortcut({ key: 'Enter' })).toBe('confirm');
    expect(resolveReviewShortcut({ key: 'C' })).toBe('keep');
    expect(resolveReviewShortcut({ key: 'd' })).toBe('discard');
    expect(resolveReviewShortcut({ key: '1' })).toBe('left');
    expect(resolveReviewShortcut({ key: '2' })).toBe('right');
    expect(resolveReviewShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
  });

  it('leaves editing and native Enter activation to the focused control', () => {
    for (const key of ['Delete', 'ArrowLeft', 'ArrowRight', 'c', 'd', 'Enter', '1', '2']) {
      expect(resolveReviewShortcut({ key }, { editing: true })).toBeNull();
    }
    expect(resolveReviewShortcut({ key: 'z', ctrlKey: true }, { editing: true })).toBeNull();
    expect(resolveReviewShortcut({ key: 'Enter' }, { nativeEnter: true })).toBeNull();
    expect(resolveReviewShortcut({ key: 'ArrowRight' }, { nativeEnter: true })).toBe('next');
  });

  it('does not repeat removal, consume modified gestures or act during composition', () => {
    for (const flags of [
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
      { altKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { metaKey: true },
    ]) {
      expect(resolveReviewShortcut({ key: 'Delete', ...flags })).toBeNull();
    }
    expect(resolveReviewShortcut({ key: 'z', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(resolveReviewShortcut({ key: 'F5' })).toBeNull();
    expect(resolveReviewShortcut({ key: 'Escape' })).toBeNull();
  });
});
