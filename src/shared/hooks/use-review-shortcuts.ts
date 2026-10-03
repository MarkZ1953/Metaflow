import { useEffect } from 'react';
import {
  preventRepeatedReviewActivation,
  resolveReviewShortcut,
  type ReviewShortcutAction,
} from '../services/review-shortcuts';

export type { ReviewShortcutAction } from '../services/review-shortcuts';

interface Options {
  enabled: boolean;
  scopeId?: string;
  onAction(action: ReviewShortcutAction): void;
}

const editingSelector =
  'input:not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="menubar"]';
const nativeEnterSelector =
  'button, input[type="button"], input[type="submit"], input[type="reset"], a[href], [role="button"], [role="link"], summary';

function scopeAvailable(scopeId: string): boolean {
  const scope = [...document.querySelectorAll<HTMLElement>('[data-review-shortcut-scope]')].find(
    (element) => element.dataset.reviewShortcutScope === scopeId,
  );
  if (!scope || scope.closest('[aria-hidden="true"]')) return false;
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
  ].filter(
    (element) => !element.closest('[aria-hidden="true"]') && element.getClientRects().length > 0,
  );
  const top = dialogs.at(-1);
  return !top || scope.contains(top);
}

export function useReviewShortcuts({ enabled, scopeId, onAction }: Options) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (scopeId && !scopeAvailable(scopeId)) return;
      const target = event.target instanceof Element ? event.target : document.activeElement;
      const context = {
        editing: !!target?.closest(editingSelector),
        nativeEnter: !!target?.closest(nativeEnterSelector),
      };
      if (preventRepeatedReviewActivation(event, context)) {
        event.preventDefault();
        return;
      }
      const action = resolveReviewShortcut(event, context);
      if (!action) return;
      event.preventDefault();
      onAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, scopeId, onAction]);
}
