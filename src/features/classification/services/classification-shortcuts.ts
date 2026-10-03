import type { ReviewShortcutAction } from '../../../shared/hooks/use-review-shortcuts';
import type { MediaEntry } from './classification-service';
import { selectedMedia } from './media-query';

export interface MediaRemovalSelection {
  sessionId: string;
  ids: string[];
}

interface ShortcutContext {
  busy: boolean;
  sessionId: string | null;
  removal: MediaRemovalSelection | null;
  entries: MediaEntry[];
  visible: MediaEntry[];
  selected: string[];
  excluded: string[];
  activeId: string | null;
  lastOperationId: string | null;
}

export type ClassificationShortcutCommand =
  | { type: 'navigate'; direction: -1 | 1 }
  | { type: 'open'; id: string }
  | { type: 'remove'; ids: string[] }
  | { type: 'confirm-removal' }
  | { type: 'keep'; ids: string[]; advance: boolean }
  | { type: 'exclude'; ids: string[] }
  | { type: 'undo' };

export function classificationShortcut(
  action: ReviewShortcutAction,
  context: ShortcutContext,
): ClassificationShortcutCommand | null {
  if (context.busy) return null;
  const excluded = new Set(context.excluded);

  if (context.removal) {
    if (
      action === 'confirm' &&
      context.sessionId === context.removal.sessionId &&
      selectedMedia(context.entries, context.removal.ids, true).some(
        (entry) => !excluded.has(entry.id),
      )
    )
      return { type: 'confirm-removal' };
    return null;
  }

  if (action === 'undo') return context.lastOperationId ? { type: 'undo' } : null;
  if (!context.sessionId) return null;

  if (context.activeId) {
    const active = context.entries.find((entry) => entry.id === context.activeId);
    if (!active) return null;
    if (action === 'remove')
      return active.protected || excluded.has(active.id)
        ? null
        : { type: 'remove', ids: [active.id] };
    if (action === 'keep') return { type: 'keep', ids: [active.id], advance: true };
    const index = context.visible.findIndex((entry) => entry.id === active.id);
    if (action === 'previous' && index > 0) return { type: 'navigate', direction: -1 };
    if (action === 'next' && index >= 0 && index < context.visible.length - 1)
      return { type: 'navigate', direction: 1 };
    return null;
  }

  const chosen = selectedMedia(context.entries, context.selected);
  if (action === 'exclude')
    return chosen.length ? { type: 'exclude', ids: chosen.map((entry) => entry.id) } : null;
  if (action === 'remove') {
    const ids = chosen
      .filter((entry) => !entry.protected && !excluded.has(entry.id))
      .map((entry) => entry.id);
    return ids.length ? { type: 'remove', ids } : null;
  }
  if (action === 'keep')
    return chosen.length
      ? { type: 'keep', ids: chosen.map((entry) => entry.id), advance: false }
      : null;
  if (action === 'confirm') {
    const selectedIds = new Set(chosen.map((entry) => entry.id));
    const first = context.visible.find((entry) => selectedIds.has(entry.id)) ?? chosen[0];
    return first ? { type: 'open', id: first.id } : null;
  }
  return null;
}
