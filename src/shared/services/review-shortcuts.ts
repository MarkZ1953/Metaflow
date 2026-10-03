export type ReviewShortcutAction =
  | 'previous'
  | 'next'
  | 'remove'
  | 'confirm'
  | 'keep'
  | 'discard'
  | 'undo'
  | 'left'
  | 'right'
  | 'exclude';

export interface ReviewKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

export interface ReviewKeyContext {
  editing?: boolean;
  nativeEnter?: boolean;
}

export function preventRepeatedReviewActivation(
  event: ReviewKey,
  context: ReviewKeyContext,
): boolean {
  return !!event.repeat && event.key === 'Enter' && !!context.nativeEnter && !context.editing;
}

export function resolveReviewShortcut(
  event: ReviewKey,
  context: ReviewKeyContext = {},
): ReviewShortcutAction | null {
  if (
    context.editing ||
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey) return key === 'z' ? 'undo' : null;
  if (key === 'enter' && context.nativeEnter) return null;
  const actions: Record<string, ReviewShortcutAction> = {
    arrowleft: 'previous',
    arrowright: 'next',
    delete: 'remove',
    enter: 'confirm',
    c: 'keep',
    d: 'discard',
    e: 'exclude',
    '1': 'left',
    '2': 'right',
  };
  return actions[key] ?? null;
}
