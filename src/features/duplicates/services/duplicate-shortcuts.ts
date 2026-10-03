import type { ComparisonSide, DuplicateComparison, DuplicateFile } from './duplicate-service';

export type DuplicateShortcutAction =
  'previous' | 'next' | 'remove' | 'confirm' | 'keep' | 'discard' | 'undo' | 'left' | 'right';

export interface DuplicateShortcutContext {
  active: boolean;
  busy: boolean;
  scanning: boolean;
  externalDialog: boolean;
  hasComparison: boolean;
  canRemove: boolean;
  canGoBack: boolean;
  hasUndo: boolean;
  confirming: boolean;
  confirmationCurrent: boolean;
}

export function allowedDuplicateShortcut(
  action: DuplicateShortcutAction,
  context: DuplicateShortcutContext,
): DuplicateShortcutAction | null {
  if (!context.active || context.busy || context.scanning || context.externalDialog) return null;
  if (context.confirming)
    return action === 'confirm' && context.confirmationCurrent && context.canRemove ? action : null;
  if (action === 'confirm') return null;
  if (action === 'undo') return context.hasUndo ? action : null;
  if (action === 'previous') return context.canGoBack ? action : null;
  if (!context.hasComparison) return null;
  if (action === 'remove' && !context.canRemove) return null;
  return action;
}

export interface DuplicateRemovalTarget {
  sessionId: string;
  comparisonId: string;
  kind: DuplicateComparison['kind'];
  side: ComparisonSide;
  file: DuplicateFile;
  keeper: DuplicateFile;
}

export function duplicateRemovalTarget(
  sessionId: string,
  comparison: DuplicateComparison,
  side: ComparisonSide,
): DuplicateRemovalTarget {
  const clone = (file: DuplicateFile): DuplicateFile => ({ ...file, stamp: { ...file.stamp } });
  return {
    sessionId,
    comparisonId: comparison.id,
    kind: comparison.kind,
    side,
    file: clone(comparison[side]),
    keeper: clone(comparison[side === 'left' ? 'right' : 'left']),
  };
}

function sameFile(left: DuplicateFile, right: DuplicateFile): boolean {
  return (
    left.path === right.path &&
    left.hash === right.hash &&
    left.stamp.size === right.stamp.size &&
    left.stamp.createdAt === right.stamp.createdAt &&
    left.stamp.modifiedAt === right.stamp.modifiedAt
  );
}

export function currentDuplicateRemoval(
  target: DuplicateRemovalTarget | null,
  sessionId: string | undefined,
  comparison: DuplicateComparison | undefined,
): boolean {
  return !!(
    target &&
    comparison &&
    target.sessionId === sessionId &&
    target.comparisonId === comparison.id &&
    target.kind === comparison.kind &&
    sameFile(target.file, comparison[target.side]) &&
    sameFile(target.keeper, comparison[target.side === 'left' ? 'right' : 'left'])
  );
}
