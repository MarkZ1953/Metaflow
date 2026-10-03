import { create } from 'zustand';
import {
  duplicateService,
  type ComparisonSide,
  type DuplicateComparison,
  type DuplicateReview,
} from '../services/duplicate-service';
import {
  advanceComparison,
  nextUnvisited,
  removeComparisons,
  sameFilePath,
} from '../services/comparison-queue';
import { clearDuplicatePreviews } from '../services/preview-cache';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { friendlyError } from '../../../shared/services/app-error';
import { duplicateMessages as t } from '../../../shared/constants/duplicate-messages';

interface DuplicateReviewState {
  review: DuplicateReview | null;
  comparisons: DuplicateComparison[];
  index: number;
  visited: string[];
  includeSimilar: boolean;
  scanning: boolean;
  error: string | null;
  notice: string | null;
  lastOperationId: string | null;
  setIncludeSimilar(value: boolean): void;
  scan(): Promise<void>;
  navigate(direction: 1 | -1): void;
  dismiss(): Promise<void>;
  remove(side: ComparisonSide): Promise<void>;
  resetDismissals(): Promise<void>;
  undoLastRemoval(): Promise<void>;
}
export const useDuplicateReviewStore = create<DuplicateReviewState>((set, get) => {
  let actionSequence = 0;
  return {
    review: null,
    comparisons: [],
    index: 0,
    visited: [],
    includeSimilar: true,
    scanning: false,
    error: null,
    notice: null,
    lastOperationId: null,
    setIncludeSimilar(value) {
      if (!useWorkflowStore.getState().busy) set({ includeSimilar: value });
    },
    async scan() {
      if (useWorkflowStore.getState().busy) return;
      const sequence = ++actionSequence;
      const includeSimilar = get().includeSimilar;
      useWorkflowStore.setState({ busy: true });
      clearDuplicatePreviews();
      set({
        scanning: true,
        error: null,
        notice: null,
        review: null,
        comparisons: [],
        index: 0,
        visited: [],
      });
      try {
        const review = await duplicateService.scanReview(includeSimilar);
        if (sequence !== actionSequence) return;
        clearDuplicatePreviews();
        set({ review, comparisons: review.comparisons, index: 0, visited: [] });
      } catch (error) {
        if (sequence === actionSequence) set({ error: friendlyError(error) });
      } finally {
        if (sequence === actionSequence) {
          set({ scanning: false });
          useWorkflowStore.setState({ busy: false, progress: null });
        }
      }
    },
    navigate(direction) {
      if (useWorkflowStore.getState().busy) return;
      const state = get();
      const current = state.comparisons[state.index];
      const visited =
        direction === 1 && current ? [...new Set([...state.visited, current.id])] : state.visited;
      set({ ...advanceComparison(state, direction), visited, error: null, notice: null });
    },
    async dismiss() {
      const { review, comparisons, index } = get();
      const comparison = comparisons[index];
      if (!review || !comparison || useWorkflowStore.getState().busy) return;
      const sequence = ++actionSequence;
      const sessionId = review.sessionId;
      const comparisonId = comparison.id;
      useWorkflowStore.setState({ busy: true });
      set({ error: null, notice: null });
      try {
        await duplicateService.dismiss(sessionId, comparisonId);
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return;
        const state = get();
        const visited = new Set([...state.visited, comparisonId]);
        set({
          ...nextUnvisited(
            removeComparisons(state, (pair) => pair.id === comparisonId),
            visited,
          ),
          visited: [...visited],
        });
      } catch (error) {
        if (sequence === actionSequence) set({ error: friendlyError(error) });
      } finally {
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false });
      }
    },
    async remove(side) {
      const { review, comparisons, index } = get();
      const comparison = comparisons[index];
      if (!review || !comparison || useWorkflowStore.getState().busy) return;
      const sequence = ++actionSequence;
      const sessionId = review.sessionId;
      const comparisonId = comparison.id;
      const path = comparison[side].path;
      useWorkflowStore.setState({
        busy: true,
        progress: { operationId: '', completed: 0, total: 1, phase: 'move' },
      });
      set({ error: null, notice: null });
      try {
        const operation = await duplicateService.remove(sessionId, comparisonId, side);
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return;
        if (
          !operation.items.some(
            (item) => sameFilePath(item.sourcePath, path) && item.status === 'completed',
          )
        ) {
          set({
            error: operation.status === 'recovery-required' ? t.recoveryRequired : t.removeFailed,
          });
          return;
        }
        clearDuplicatePreviews();
        const state = get();
        const visited = new Set([...state.visited, comparisonId]);
        const queue = removeComparisons(
          state,
          (pair) => sameFilePath(pair.left.path, path) || sameFilePath(pair.right.path, path),
        );
        set({
          ...nextUnvisited(queue, visited),
          visited: [...visited],
          lastOperationId: operation.id,
          notice: t.removed,
        });
      } catch (error) {
        if (sequence === actionSequence) set({ error: friendlyError(error) });
      } finally {
        await Promise.all([
          useWorkflowStore.getState().loadHistory(),
          useWorkflowStore.getState().refresh(),
          useExplorerStore.getState().refresh(),
        ]);
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false, progress: null });
      }
    },
    async resetDismissals() {
      if (useWorkflowStore.getState().busy) return;
      useWorkflowStore.setState({ busy: true });
      set({ error: null, notice: null });
      try {
        await duplicateService.resetDismissals();
        clearDuplicatePreviews();
        set({
          notice: t.resetDone,
          review: null,
          comparisons: [],
          index: 0,
          visited: [],
        });
      } catch (error) {
        set({ error: friendlyError(error) });
      } finally {
        useWorkflowStore.setState({ busy: false });
      }
    },
    async undoLastRemoval() {
      const id = get().lastOperationId;
      if (!id || useWorkflowStore.getState().busy) return;
      await useWorkflowStore.getState().undo(id);
      const operation = useWorkflowStore.getState().history.find((item) => item.id === id);
      if (operation?.items.some((item) => item.status === 'undone')) {
        clearDuplicatePreviews();
        set({ lastOperationId: null, notice: t.restored });
      }
    },
  };
});
