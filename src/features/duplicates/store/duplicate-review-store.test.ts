import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchProgress, Operation } from '../../inbox/schemas/inbox-schema';
import type { DuplicateComparison, DuplicateReview } from '../services/duplicate-service';

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  remove: vi.fn(),
  dismiss: vi.fn(),
  reset: vi.fn(),
  clearPreviews: vi.fn(),
  explorerRefresh: vi.fn(),
  workflow: {
    busy: false,
    progress: null as BatchProgress | null,
    history: [] as Operation[],
    loadHistory: vi.fn(),
    refresh: vi.fn(),
    undo: vi.fn(),
  },
}));
vi.mock('../services/duplicate-service', () => ({
  duplicateService: {
    scanReview: mocks.scan,
    remove: mocks.remove,
    dismiss: mocks.dismiss,
    resetDismissals: mocks.reset,
  },
}));
vi.mock('../services/preview-cache', () => ({ clearDuplicatePreviews: mocks.clearPreviews }));
vi.mock('../../inbox/store/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mocks.workflow,
    setState: (state: Record<string, unknown>) => Object.assign(mocks.workflow, state),
  },
}));
vi.mock('../../explorer/store/explorer-store', () => ({
  useExplorerStore: { getState: () => ({ refresh: mocks.explorerRefresh }) },
}));
import { useDuplicateReviewStore } from './duplicate-review-store';

const file = (path: string) => ({
  path,
  hash: 'hash',
  planned: false,
  stamp: { size: 20, createdAt: 1, modifiedAt: 2 },
});
const pair = (id: string, left: string, right: string): DuplicateComparison => ({
  id,
  kind: 'exact',
  left: file(left),
  right: file(right),
});
const review: DuplicateReview = {
  sessionId: 'session-a',
  comparisons: [pair('ab', 'a', 'b'), pair('ac', 'a', 'c'), pair('bc', 'b', 'c')],
  unreadableCount: 0,
  ignoredCount: 0,
  truncated: false,
};
function operation(path: string, status = 'completed'): Operation {
  return {
    id: 'operation',
    createdAt: 1,
    status,
    items: [
      {
        id: 'item',
        operationId: 'operation',
        sourcePath: path,
        destinationPath: 'recovery',
        ruleName: 'Duplicados',
        dateSource: 'created',
        dateUsed: 1,
        stamp: file(path).stamp,
        hash: 'hash',
        identity: 'identity',
        status,
        error: null,
        kind: 'move',
        undoPath: null,
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.workflow, { busy: false, progress: null, history: [] });
  useDuplicateReviewStore.setState({
    review,
    comparisons: review.comparisons,
    index: 0,
    visited: [],
    includeSimilar: true,
    scanning: false,
    error: null,
    notice: null,
    lastOperationId: null,
  });
});
describe('Duplicate review actions', () => {
  it('captures pair and side, blocks a second action and navigation, then continues with the remaining copies', async () => {
    let complete!: (result: Operation) => void;
    mocks.remove.mockReturnValue(
      new Promise<Operation>((resolve) => {
        complete = resolve;
      }),
    );
    const removal = useDuplicateReviewStore.getState().remove('left');
    expect(mocks.workflow.busy).toBe(true);
    useDuplicateReviewStore.getState().navigate(1);
    await useDuplicateReviewStore.getState().dismiss();
    await useDuplicateReviewStore.getState().remove('right');
    expect(useDuplicateReviewStore.getState().index).toBe(0);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('session-a', 'ab', 'left');
    complete(operation('a'));
    await removal;
    expect(
      useDuplicateReviewStore.getState().comparisons.map((comparison) => comparison.id),
    ).toEqual(['bc']);
    expect(useDuplicateReviewStore.getState().lastOperationId).toBe('operation');
    expect(mocks.workflow.busy).toBe(false);
    expect(mocks.workflow.loadHistory).toHaveBeenCalledOnce();
  });
  it('does not advance or claim removal when history records a failed item', async () => {
    mocks.remove.mockResolvedValue(operation('a', 'failed'));
    await useDuplicateReviewStore.getState().remove('left');
    expect(useDuplicateReviewStore.getState().comparisons).toEqual(review.comparisons);
    expect(useDuplicateReviewStore.getState().index).toBe(0);
    expect(useDuplicateReviewStore.getState().lastOperationId).toBeNull();
    expect(useDuplicateReviewStore.getState().error).toContain('no se retiró');
  });
  it('keeps the pair visible after failed dismissal and only removes it after persistence succeeds', async () => {
    mocks.dismiss.mockRejectedValueOnce({ code: 'DATABASE_ERROR' });
    await useDuplicateReviewStore.getState().dismiss();
    expect(useDuplicateReviewStore.getState().comparisons).toHaveLength(3);
    mocks.dismiss.mockResolvedValueOnce(undefined);
    await useDuplicateReviewStore.getState().dismiss();
    expect(
      useDuplicateReviewStore.getState().comparisons.map((comparison) => comparison.id),
    ).toEqual(['ac', 'bc']);
    expect(mocks.dismiss).toHaveBeenLastCalledWith('session-a', 'ab');
  });
  it('invalidates the old session when a fresh scan begins even if that scan is cancelled', async () => {
    mocks.scan.mockRejectedValue({ code: 'OPERATION_CANCELLED' });
    const scanning = useDuplicateReviewStore.getState().scan();
    expect(useDuplicateReviewStore.getState().review).toBeNull();
    expect(useDuplicateReviewStore.getState().comparisons).toEqual([]);
    await scanning;
    expect(useDuplicateReviewStore.getState().review).toBeNull();
    expect(useDuplicateReviewStore.getState().error).toContain('canceló');
    expect(mocks.workflow.busy).toBe(false);
  });
  it('clears session and previews when dismissals are reset', async () => {
    mocks.reset.mockResolvedValue(undefined);
    await useDuplicateReviewStore.getState().resetDismissals();
    expect(useDuplicateReviewStore.getState().review).toBeNull();
    expect(useDuplicateReviewStore.getState().comparisons).toEqual([]);
    expect(mocks.clearPreviews).toHaveBeenCalledOnce();
    await useDuplicateReviewStore.getState().remove('left');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('cannot apply a delayed result to a replaced session', async () => {
    let complete!: (result: Operation) => void;
    mocks.remove.mockReturnValue(
      new Promise<Operation>((resolve) => {
        complete = resolve;
      }),
    );
    const removal = useDuplicateReviewStore.getState().remove('left');
    const replacement = { ...review, sessionId: 'session-b', comparisons: [pair('de', 'd', 'e')] };
    useDuplicateReviewStore.setState({
      review: replacement,
      comparisons: replacement.comparisons,
      index: 0,
    });
    complete(operation('a'));
    await removal;
    expect(
      useDuplicateReviewStore.getState().comparisons.map((comparison) => comparison.id),
    ).toEqual(['de']);
    expect(useDuplicateReviewStore.getState().lastOperationId).toBeNull();
  });
});
