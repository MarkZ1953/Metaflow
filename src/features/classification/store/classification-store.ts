import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  classificationService,
  mediaProgressSchema,
  type MediaEntry,
  type MediaProgress,
  type MediaScan,
  type MediaScanOptions,
  type MediaCategory,
} from '../services/classification-service';
import { classificationError } from '../services/classification-error';
import {
  emptyMediaFilters,
  visibleMedia,
  nextMediaId,
  sameMediaPath,
  selectedMedia,
  type MediaFilters,
} from '../services/media-query';
import { clearMediaPreviews } from '../services/media-preview-cache';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import { useDetectionSettingsStore } from './detection-settings-store';
interface ClassificationState {
  review: MediaScan | null;
  entries: MediaEntry[];
  options: MediaScanOptions;
  selectedFolderPaths: string[];
  pickingFolders: boolean;
  filters: MediaFilters;
  selected: string[];
  excluded: string[];
  showExcluded: boolean;
  showProtected: boolean;
  activeId: string | null;
  page: number;
  scanning: boolean;
  cancelling: boolean;
  progress: MediaProgress | null;
  error: string | null;
  notice: string | null;
  lastOperationId: string | null;
  setOptions(options: Partial<MediaScanOptions>): void;
  setScanScope(scope: 'selected' | 'workspace'): void;
  chooseFolders(): Promise<void>;
  removeFolder(path: string): void;
  setFilters(filters: Partial<MediaFilters>): void;
  setPage(page: number): void;
  select(id: string, value: boolean): void;
  selectPage(ids: string[], value: boolean): void;
  clearSelection(): void;
  exclude(ids: string[]): void;
  include(id: string): void;
  setShowExcluded(value: boolean): void;
  setShowProtected(value: boolean): void;
  open(id: string | null): void;
  navigate(direction: -1 | 1): void;
  scan(): Promise<void>;
  cancel(): Promise<void>;
  protect(ids: string[], value: boolean, advance?: boolean): Promise<void>;
  restoreNormal(ids: string[]): Promise<void>;
  correctCategories(ids: string[], categories: MediaCategory[] | null): Promise<boolean>;
  updateCategories(sessionId: string, entries: MediaEntry[], notice?: string): void;
  remove(ids: string[]): Promise<void>;
  undoLastRemoval(): Promise<void>;
}
export const useClassificationStore = create<ClassificationState>((set, get) => {
  let actionSequence = 0;
  const available = () => !useWorkflowStore.getState().busy && !get().pickingFolders;
  return {
    review: null,
    entries: [],
    options: { folderPath: null, folderPaths: [], recursive: true, includeVideos: true },
    selectedFolderPaths: [],
    pickingFolders: false,
    filters: { ...emptyMediaFilters },
    selected: [],
    excluded: [],
    showExcluded: false,
    showProtected: false,
    activeId: null,
    page: 1,
    scanning: false,
    cancelling: false,
    progress: null,
    error: null,
    notice: null,
    lastOperationId: null,
    setOptions(options) {
      if (available()) set((state) => ({ options: { ...state.options, ...options } }));
    },
    setScanScope(scope) {
      if (!available()) return;
      set((state) => ({
        options: {
          ...state.options,
          folderPath: null,
          folderPaths: scope === 'selected' ? [...state.selectedFolderPaths] : null,
        },
        error: null,
      }));
    },
    async chooseFolders() {
      if (!available()) return;
      const sequence = ++actionSequence;
      const capturedOptions = get().options;
      const capturedFolders = get().selectedFolderPaths;
      const current = () =>
        sequence === actionSequence &&
        get().options === capturedOptions &&
        get().selectedFolderPaths === capturedFolders;
      useWorkflowStore.setState({ busy: true });
      set({ pickingFolders: true, error: null });
      try {
        const chosen = await classificationService.selectFolders();
        if (!current() || !chosen.length) return;
        const paths = [...capturedFolders];
        for (const folder of chosen) {
          const key = folder.path.replace(/[\\/]+$/, '');
          if (!paths.some((path) => sameMediaPath(path.replace(/[\\/]+$/, ''), key)))
            paths.push(folder.path);
        }
        if (paths.length > 32) {
          set({ error: t.folderLimit });
          return;
        }
        set({
          selectedFolderPaths: paths,
          options: {
            ...capturedOptions,
            folderPath: null,
            folderPaths: capturedOptions.folderPaths === null ? null : [...paths],
          },
        });
      } catch (error) {
        if (current()) set({ error: classificationError(error) });
      } finally {
        if (sequence === actionSequence) {
          set({ pickingFolders: false });
          useWorkflowStore.setState({ busy: false });
        }
      }
    },
    removeFolder(path) {
      if (!available()) return;
      set((state) => {
        const paths = state.selectedFolderPaths.filter((folder) => !sameMediaPath(folder, path));
        return {
          selectedFolderPaths: paths,
          options: {
            ...state.options,
            folderPath: null,
            folderPaths: state.options.folderPaths === null ? null : [...paths],
          },
          error: null,
        };
      });
    },
    setFilters(filters) {
      if (available())
        set((state) => ({
          filters: { ...state.filters, ...filters },
          ...(filters.status === 'protected' ? { showProtected: true } : {}),
          ...(filters.status === 'excluded' ? { showExcluded: true } : {}),
          page: 1,
        }));
    },
    setPage(page) {
      if (available()) set({ page: Math.max(1, page) });
    },
    select(id, value) {
      if (!available() || !get().entries.some((entry) => entry.id === id)) return;
      if (value && !get().selected.includes(id) && get().selected.length >= 1_000) {
        set({ error: t.selectionLimit });
        return;
      }
      set((state) => ({
        selected: value
          ? [...new Set([...state.selected, id])]
          : state.selected.filter((item) => item !== id),
      }));
    },
    selectPage(ids, value) {
      if (!available()) return;
      const existing = new Set(get().entries.map((entry) => entry.id));
      const valid = new Set(ids.filter((id) => existing.has(id)));
      if (value && new Set([...get().selected, ...valid]).size > 1_000) {
        set({ error: t.selectionLimit });
        return;
      }
      set((state) => ({
        selected: value
          ? [...new Set([...state.selected, ...valid])]
          : state.selected.filter((id) => !valid.has(id)),
      }));
    },
    clearSelection() {
      if (available()) set({ selected: [] });
    },
    exclude(ids) {
      const state = get();
      if (!available() || !state.review) return;
      const selection = new Set(state.selected);
      const chosen = selectedMedia(state.entries, ids).filter((entry) => selection.has(entry.id));
      if (!chosen.length) return;
      const excluded = new Set(chosen.map((entry) => entry.id));
      set((state) => ({
        excluded: [...new Set([...state.excluded, ...excluded])],
        selected: state.selected.filter((id) => !excluded.has(id)),
        activeId: state.activeId && excluded.has(state.activeId) ? null : state.activeId,
        notice: t.excludedNotice(chosen.length),
      }));
    },
    include(id) {
      if (!available() || !get().excluded.includes(id)) return;
      set((state) => ({
        excluded: state.excluded.filter((item) => item !== id),
        notice: t.includedNotice,
      }));
    },
    setShowExcluded(value) {
      if (available())
        set((state) => ({
          showExcluded: value,
          filters:
            !value && state.filters.status === 'excluded'
              ? { ...state.filters, status: 'all' }
              : state.filters,
          page: 1,
          ...(!value && state.activeId && state.excluded.includes(state.activeId)
            ? { activeId: null }
            : {}),
        }));
    },
    setShowProtected(value) {
      if (available())
        set((state) => ({
          showProtected: value,
          filters:
            !value && state.filters.status === 'protected'
              ? { ...state.filters, status: 'all' }
              : state.filters,
          page: 1,
          ...(!value &&
          state.entries.some((entry) => entry.id === state.activeId && entry.protected)
            ? { activeId: null }
            : {}),
        }));
    },
    open(id) {
      if (available() && (id === null || get().entries.some((entry) => entry.id === id)))
        set({ activeId: id });
    },
    navigate(direction) {
      if (!available()) return;
      const state = get();
      const visible = visibleMedia(state.entries, state.filters, state);
      const index = visible.findIndex((entry) => entry.id === state.activeId);
      const next = visible[index + direction];
      if (index >= 0 && next) set({ activeId: next.id });
    },
    async scan() {
      if (!available()) return;
      if (get().options.folderPaths?.length === 0) {
        set({ error: t.selectedFoldersEmpty });
        return;
      }
      const sequence = ++actionSequence;
      const options = {
        ...get().options,
        ...(get().options.folderPaths !== undefined && get().options.folderPaths !== null
          ? { folderPaths: [...get().options.folderPaths!] }
          : {}),
      };
      useWorkflowStore.setState({ busy: true, progress: null });
      clearMediaPreviews();
      set({
        review: null,
        entries: [],
        selected: [],
        excluded: [],
        showExcluded: get().filters.status === 'excluded',
        showProtected: get().filters.status === 'protected',
        activeId: null,
        page: 1,
        scanning: true,
        cancelling: false,
        progress: null,
        error: null,
        notice: null,
      });
      let unlisten: UnlistenFn | undefined;
      try {
        try {
          unlisten = await listen('media-scan-progress', (event) => {
            const parsed = mediaProgressSchema.safeParse(event.payload);
            if (sequence === actionSequence && get().scanning && parsed.success)
              set({ progress: parsed.data });
          });
        } catch {
          /* Analysis remains available when the progress channel is unavailable. */
        }
        if (get().cancelling) {
          set({ notice: t.cancelled });
          return;
        }
        const review = await classificationService.scan(options);
        if (sequence !== actionSequence) return;
        clearMediaPreviews();
        set({ review, entries: review.entries, notice: review.cancelled ? t.cancelled : null });
      } catch (error) {
        if (sequence === actionSequence) set({ error: classificationError(error) });
      } finally {
        unlisten?.();
        if (sequence === actionSequence) {
          set({ scanning: false, cancelling: false, progress: null });
          useWorkflowStore.setState({ busy: false, progress: null });
        }
      }
    },
    async cancel() {
      if (!get().scanning || get().cancelling) return;
      set({ cancelling: true });
      await useWorkflowStore.getState().cancel();
    },
    async protect(ids, value, advance = false) {
      const state = get();
      const chosen = selectedMedia(state.entries, ids);
      if (!available() || !state.review || !chosen.length) return;
      const sequence = ++actionSequence;
      const sessionId = state.review.sessionId;
      const capturedIds = chosen.map((entry) => entry.id);
      const advanceFrom = advance ? state.activeId : null;
      const visible = visibleMedia(state.entries, state.filters, state);
      const nextCandidates = advance
        ? visible.slice(visible.findIndex((entry) => entry.id === advanceFrom) + 1)
        : [];
      useWorkflowStore.setState({ busy: true });
      set({ error: null, notice: null });
      try {
        const entries = await classificationService.protect(sessionId, capturedIds, value);
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return;
        const captured = new Set(capturedIds);
        const updatedVisible = new Set(
          visibleMedia(entries, get().filters, get()).map((entry) => entry.id),
        );
        const nextId = nextCandidates.find((entry) => updatedVisible.has(entry.id))?.id ?? null;
        set((current) => ({
          entries,
          selected: current.selected.filter((id) => !captured.has(id)),
          notice: value ? t.saved : t.unprotected,
          ...(advance && current.activeId === advanceFrom
            ? { activeId: nextId }
            : current.activeId && !updatedVisible.has(current.activeId)
              ? { activeId: null }
              : {}),
        }));
      } catch (error) {
        if (sequence === actionSequence) set({ error: classificationError(error) });
      } finally {
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false });
      }
    },
    async restoreNormal(ids) {
      const state = get();
      const chosen = selectedMedia(state.entries, ids).filter(
        (entry) => entry.protected || state.excluded.includes(entry.id),
      );
      if (!available() || !state.review || !chosen.length) return;
      const sequence = ++actionSequence;
      const sessionId = state.review.sessionId;
      const capturedIds = chosen.map((entry) => entry.id);
      const protectedIds = chosen.filter((entry) => entry.protected).map((entry) => entry.id);
      useWorkflowStore.setState({ busy: true });
      set({ error: null, notice: null });
      try {
        const entries = protectedIds.length
          ? await classificationService.protect(sessionId, protectedIds, false)
          : state.entries;
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return;
        const captured = new Set(capturedIds);
        set((current) => ({
          entries,
          excluded: current.excluded.filter((id) => !captured.has(id)),
          notice: t.restoredNormal,
        }));
      } catch (error) {
        if (sequence === actionSequence && get().review?.sessionId === sessionId)
          set({ error: classificationError(error) });
      } finally {
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false });
      }
    },
    updateCategories(sessionId, entries, notice) {
      const current = get();
      if (current.review?.sessionId !== sessionId) return;
      const visible = new Set(
        visibleMedia(entries, current.filters, current).map((entry) => entry.id),
      );
      set({
        entries,
        review: {
          ...current.review,
          entries,
          unreadableCount: entries.filter((entry) => entry.status === 'error').length,
        },
        ...(current.activeId && !visible.has(current.activeId) ? { activeId: null } : {}),
        ...(notice !== undefined ? { notice, error: null } : {}),
      });
    },
    async correctCategories(ids, categories) {
      const state = get();
      const chosen = selectedMedia(state.entries, ids);
      if (!available() || !state.review || !chosen.length) return false;
      if (chosen.length > 1_000) {
        set({ error: t.selectionLimit });
        return false;
      }
      const allowed = new Set(Object.keys(t.categories));
      if (
        categories !== null &&
        (!categories.length ||
          categories.length > 8 ||
          categories.some((category) => !allowed.has(category)))
      ) {
        set({ error: t.correctionInvalid });
        return false;
      }
      const sequence = ++actionSequence;
      const sessionId = state.review.sessionId;
      const capturedIds = chosen.map((entry) => entry.id);
      useWorkflowStore.setState({ busy: true });
      set({ error: null, notice: null });
      try {
        const entries = await classificationService.categories(
          sessionId,
          capturedIds,
          categories === null ? null : [...new Set(categories)],
        );
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return false;
        get().updateCategories(sessionId, entries);
        set({ notice: categories === null ? t.correctionResetDone : t.correctionSaved });
        await useDetectionSettingsStore.getState().load(true);
        return true;
      } catch (error) {
        if (sequence === actionSequence && get().review?.sessionId === sessionId)
          set({ error: classificationError(error) });
        return false;
      } finally {
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false });
      }
    },
    async remove(ids) {
      const state = get();
      const excluded = new Set(state.excluded);
      const chosen = selectedMedia(state.entries, ids, true).filter(
        (entry) => !excluded.has(entry.id),
      );
      if (!available() || !state.review || !chosen.length) return;
      const sequence = ++actionSequence;
      const sessionId = state.review.sessionId;
      const capturedIds = chosen.map((entry) => entry.id);
      useWorkflowStore.setState({
        busy: true,
        progress: { operationId: '', completed: 0, total: chosen.length, phase: 'move' },
      });
      set({ error: null, notice: null });
      try {
        const operation = await classificationService.remove(sessionId, capturedIds);
        if (sequence !== actionSequence || get().review?.sessionId !== sessionId) return;
        const completed = chosen.filter((entry) =>
          operation.items.some(
            (item) => item.status === 'completed' && sameMediaPath(item.sourcePath, entry.path),
          ),
        );
        if (!completed.length) {
          set({ error: t.removeFailed });
          return;
        }
        clearMediaPreviews();
        const removed = new Set(completed.map((entry) => entry.id));
        const current = get();
        const filtered = visibleMedia(current.entries, current.filters, current);
        set({
          entries: current.entries.filter((entry) => !removed.has(entry.id)),
          selected: current.selected.filter((id) => !removed.has(id)),
          excluded: current.excluded.filter((id) => !removed.has(id)),
          activeId: nextMediaId(filtered, current.activeId, removed),
          lastOperationId: operation.id,
          notice: completed.length === chosen.length ? t.removed : null,
          error: completed.length === chosen.length ? null : t.partial,
        });
      } catch (error) {
        if (sequence === actionSequence) set({ error: classificationError(error) });
      } finally {
        await Promise.allSettled([
          useWorkflowStore.getState().loadHistory(),
          useWorkflowStore.getState().refresh(),
          useExplorerStore.getState().refresh(),
        ]);
        if (sequence === actionSequence) useWorkflowStore.setState({ busy: false, progress: null });
      }
    },
    async undoLastRemoval() {
      const id = get().lastOperationId;
      if (!id || !available()) return;
      await useWorkflowStore.getState().undo(id);
      const operation = useWorkflowStore.getState().history.find((item) => item.id === id);
      if (operation?.items.some((item) => item.status === 'undone')) {
        clearMediaPreviews();
        set({ lastOperationId: null, notice: t.restored });
      }
    },
  };
});
