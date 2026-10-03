import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchProgress, Operation } from '../../inbox/schemas/inbox-schema';
import type { MediaEntry, MediaScan } from '../services/classification-service';
import { emptyMediaFilters } from '../services/media-query';
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  selectFolders: vi.fn(),
  protect: vi.fn(),
  categories: vi.fn(),
  loadSettings: vi.fn(),
  remove: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  clearPreviews: vi.fn(),
  explorerRefresh: vi.fn(),
  workflow: {
    busy: false,
    progress: null as BatchProgress | null,
    history: [] as Operation[],
    loadHistory: vi.fn(),
    refresh: vi.fn(),
    undo: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('../services/classification-service', async (original) => ({
  ...(await original<typeof import('../services/classification-service')>()),
  classificationService: {
    scan: mocks.scan,
    selectFolders: mocks.selectFolders,
    protect: mocks.protect,
    remove: mocks.remove,
    categories: mocks.categories,
    loadSettings: mocks.loadSettings,
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../services/media-preview-cache', () => ({ clearMediaPreviews: mocks.clearPreviews }));
vi.mock('../../inbox/store/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mocks.workflow,
    setState: (value: Record<string, unknown>) => Object.assign(mocks.workflow, value),
  },
}));
vi.mock('../../explorer/store/explorer-store', () => ({
  useExplorerStore: { getState: () => ({ refresh: mocks.explorerRefresh }) },
}));
import { useClassificationStore } from './classification-store';
import { useDetectionSettingsStore } from './detection-settings-store';
import { defaultClassificationSettings } from '../services/classification-service';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
const entry = (id: string, protectedValue = false): MediaEntry => ({
  id,
  path: `F:\\Fotos\\${id}.jpg`,
  name: `${id}.jpg`,
  kind: 'image',
  stamp: { size: 20, createdAt: 1, modifiedAt: 2 },
  labels: [{ category: 'memes', score: 0.8 }],
  protected: protectedValue,
  uncertain: false,
  status: 'classified',
  error: null,
});
const review: MediaScan = {
  sessionId: 'session-a',
  entries: [entry('a'), entry('b', true), entry('c')],
  unreadableCount: 0,
  skippedCount: 0,
  truncated: false,
  cancelled: false,
  modelVersion: 'local-v1',
};
function operation(statuses: [string, string][]): Operation {
  return {
    id: 'operation',
    createdAt: 1,
    status: 'completed',
    items: statuses.map(([id, status]) => ({
      id,
      operationId: 'operation',
      sourcePath: `F:\\Fotos\\${id}.jpg`,
      destinationPath: 'F:\\Fotos\\.metaflow-recovery\\a.jpg',
      ruleName: 'Depuración',
      dateSource: 'created',
      dateUsed: 1,
      stamp: entry(id).stamp,
      hash: 'hash',
      identity: 'identity',
      status,
      error: null,
      kind: 'move',
      undoPath: null,
    })),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.loadSettings.mockResolvedValue({
    settings: defaultClassificationSettings,
    correctionCount: 1,
    ocrAvailable: true,
    ocrLanguages: ['es-CO'],
  });
  useDetectionSettingsStore.setState({ loading: false, loaded: false, error: null, notice: null });
  Object.assign(mocks.workflow, { busy: false, progress: null, history: [] });
  useClassificationStore.setState({
    review,
    entries: review.entries,
    options: { folderPath: null, folderPaths: null, recursive: true, includeVideos: true },
    selectedFolderPaths: [],
    pickingFolders: false,
    filters: { ...emptyMediaFilters },
    selected: [],
    excluded: [],
    showExcluded: false,
    showProtected: true,
    activeId: null,
    page: 1,
    scanning: false,
    cancelling: false,
    progress: null,
    error: null,
    notice: null,
    lastOperationId: null,
  });
});
describe('Safe explicit media review decisions', () => {
  it('starts with an empty explicit folder selection and never turns it into a Workspace scan', async () => {
    expect(useClassificationStore.getInitialState().options.folderPaths).toEqual([]);
    useClassificationStore.getState().setScanScope('selected');
    await useClassificationStore.getState().scan();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(useClassificationStore.getState().review).toBe(review);
    expect(useClassificationStore.getState().selected).toEqual([]);
    expect(useClassificationStore.getState().error).toBe(t.selectedFoldersEmpty);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('adds selected folders across picker batches, deduplicates Windows paths and preserves choices when switching scope', async () => {
    useClassificationStore.getState().setScanScope('selected');
    useClassificationStore.getState().setOptions({ recursive: false, includeVideos: false });
    mocks.selectFolders
      .mockResolvedValueOnce([{ path: 'G:\\SoloFotos', name: 'SoloFotos' }])
      .mockResolvedValueOnce([
        { path: 'g:/solofotos/', name: 'soloFotos' },
        { path: 'H:\\Viajes', name: 'Viajes' },
      ]);
    await useClassificationStore.getState().chooseFolders();
    await useClassificationStore.getState().chooseFolders();
    expect(useClassificationStore.getState().options.folderPaths).toEqual([
      'G:\\SoloFotos',
      'H:\\Viajes',
    ]);
    useClassificationStore.getState().setScanScope('workspace');
    expect(useClassificationStore.getState().options.folderPaths).toBeNull();
    expect(useClassificationStore.getState().selectedFolderPaths).toEqual([
      'G:\\SoloFotos',
      'H:\\Viajes',
    ]);
    useClassificationStore.getState().setScanScope('selected');
    expect(useClassificationStore.getState().options).toEqual({
      folderPath: null,
      folderPaths: ['G:\\SoloFotos', 'H:\\Viajes'],
      recursive: false,
      includeVideos: false,
    });
    mocks.scan.mockResolvedValue(review);
    await useClassificationStore.getState().scan();
    expect(mocks.scan).toHaveBeenCalledExactlyOnceWith({
      folderPath: null,
      folderPaths: ['G:\\SoloFotos', 'H:\\Viajes'],
      recursive: false,
      includeVideos: false,
    });
    expect(useClassificationStore.getState().selectedFolderPaths).toEqual([
      'G:\\SoloFotos',
      'H:\\Viajes',
    ]);
  });
  it('blocks analysis, gallery decisions and scope changes while picking folders, retaining selection on cancellation', async () => {
    useClassificationStore.setState({ selected: ['a'], selectedFolderPaths: ['G:\\Fotos'] });
    useClassificationStore.getState().setScanScope('selected');
    let finish!: (folders: { path: string; name: string }[]) => void;
    mocks.selectFolders.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = useClassificationStore.getState().chooseFolders();
    expect(mocks.workflow.busy).toBe(true);
    expect(useClassificationStore.getState().pickingFolders).toBe(true);
    await useClassificationStore.getState().scan();
    await useClassificationStore.getState().protect(['a'], true);
    await useClassificationStore.getState().remove(['a']);
    useClassificationStore.getState().exclude(['a']);
    useClassificationStore.getState().setScanScope('workspace');
    useClassificationStore.getState().removeFolder('G:\\Fotos');
    await useClassificationStore.getState().chooseFolders();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.protect).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.selectFolders).toHaveBeenCalledOnce();
    expect(useClassificationStore.getState().excluded).toEqual([]);
    finish([]);
    await pending;
    expect(useClassificationStore.getState().options.folderPaths).toEqual(['G:\\Fotos']);
    expect(useClassificationStore.getState().selected).toEqual(['a']);
    expect(useClassificationStore.getState().review).toBe(review);
    expect(useClassificationStore.getState().pickingFolders).toBe(false);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('does not overwrite newer folder options when a stale picker completes', async () => {
    useClassificationStore.getState().setScanScope('selected');
    let finish!: (folders: { path: string; name: string }[]) => void;
    mocks.selectFolders.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = useClassificationStore.getState().chooseFolders();
    const options = {
      ...useClassificationStore.getState().options,
      folderPaths: ['H:\\Replacement'],
    };
    useClassificationStore.setState({ options, selectedFolderPaths: ['H:\\Replacement'] });
    finish([{ path: 'G:\\Old', name: 'Old' }]);
    await pending;
    expect(useClassificationStore.getState().options).toBe(options);
    expect(useClassificationStore.getState().selectedFolderPaths).toEqual(['H:\\Replacement']);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('keeps existing folders on picker failure or folder limit and prevents a scan after removing the last folder', async () => {
    const paths = Array.from({ length: 32 }, (_, index) => `G:\\Folder${index}`);
    useClassificationStore.setState({ selectedFolderPaths: paths });
    useClassificationStore.getState().setScanScope('selected');
    mocks.selectFolders
      .mockRejectedValueOnce({ code: 'FOLDER_NOT_AUTHORIZED' })
      .mockResolvedValueOnce([{ path: 'H:\\New', name: 'New' }]);
    await useClassificationStore.getState().chooseFolders();
    expect(useClassificationStore.getState().selectedFolderPaths).toEqual(paths);
    await useClassificationStore.getState().chooseFolders();
    expect(useClassificationStore.getState().error).toBe(t.folderLimit);
    expect(useClassificationStore.getState().selectedFolderPaths).toEqual(paths);
    paths.forEach((path) => useClassificationStore.getState().removeFolder(path));
    expect(useClassificationStore.getState().options.folderPaths).toEqual([]);
    await useClassificationStore.getState().scan();
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it('saves overlapping category corrections without changing selection, exclusions or conservation decisions', async () => {
    useClassificationStore.setState({ selected: ['a', 'b'], excluded: ['b'] });
    const updated = review.entries.map((item) => ({
      ...item,
      labels: [
        { category: 'screenshots' as const, score: 0 },
        { category: 'people' as const, score: 0 },
      ],
      corrected: true,
      learned: false,
    }));
    mocks.categories.mockResolvedValue(updated);
    expect(
      await useClassificationStore
        .getState()
        .correctCategories(['a', 'b'], ['screenshots', 'people']),
    ).toBe(true);
    expect(mocks.categories).toHaveBeenCalledExactlyOnceWith(
      'session-a',
      ['a', 'b'],
      ['screenshots', 'people'],
    );
    expect(useClassificationStore.getState().selected).toEqual(['a', 'b']);
    expect(useClassificationStore.getState().excluded).toEqual(['b']);
    expect(useClassificationStore.getState().entries[1]!.protected).toBe(true);
    expect(useClassificationStore.getState().review!.entries).toEqual(updated);
    expect(useDetectionSettingsStore.getState().snapshot.correctionCount).toBe(1);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.protect).not.toHaveBeenCalled();
  });
  it('rejects empty corrections and leaves previous categories intact on persistence failure', async () => {
    expect(await useClassificationStore.getState().correctCategories(['a'], [])).toBe(false);
    expect(mocks.categories).not.toHaveBeenCalled();
    mocks.categories.mockRejectedValue({ code: 'DATABASE_ERROR' });
    expect(await useClassificationStore.getState().correctCategories(['a'], ['people'])).toBe(
      false,
    );
    expect(useClassificationStore.getState().entries).toEqual(review.entries);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('preserves corrected categories and provenance when the next decision protects the file', async () => {
    const corrected = review.entries.map((item) =>
      item.id === 'a'
        ? {
            ...item,
            labels: [{ category: 'people' as const, score: 0 }],
            corrected: true,
            learned: false,
          }
        : item,
    );
    mocks.categories.mockResolvedValue(corrected);
    await useClassificationStore.getState().correctCategories(['a'], ['people']);
    mocks.protect.mockResolvedValue(
      corrected.map((item) => ({ ...item, protected: item.id === 'a' || item.protected })),
    );
    await useClassificationStore.getState().protect(['a'], true);
    const kept = useClassificationStore.getState().entries.find((item) => item.id === 'a')!;
    expect(kept.corrected).toBe(true);
    expect(kept.labels.map((label) => label.category)).toEqual(['people']);
    expect(kept.protected).toBe(true);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('resets to automatic detection and recomputes error statistics from successful returned entries', async () => {
    useClassificationStore.setState({ review: { ...review, unreadableCount: 1 } });
    mocks.categories.mockResolvedValue(review.entries);
    expect(await useClassificationStore.getState().correctCategories(['a'], null)).toBe(true);
    expect(mocks.categories).toHaveBeenCalledExactlyOnceWith('session-a', ['a'], null);
    expect(useClassificationStore.getState().review!.unreadableCount).toBe(0);
  });
  it('replaces the previous correction notice when all examples are cleared in the current analysis', () => {
    useClassificationStore.setState({
      notice: t.correctionSaved,
      error: 'An earlier error',
      selected: ['a'],
      excluded: ['c'],
    });
    useClassificationStore
      .getState()
      .updateCategories('session-a', review.entries, t.correctionsCleared);
    expect(useClassificationStore.getState().notice).toBe(t.correctionsCleared);
    expect(useClassificationStore.getState().error).toBeNull();
    expect(useClassificationStore.getState().selected).toEqual(['a']);
    expect(useClassificationStore.getState().excluded).toEqual(['c']);
    expect(useClassificationStore.getState().entries[1]!.protected).toBe(true);
  });
  it('rejects late correction results and late cleared-example entries for a replaced analysis', async () => {
    let complete!: (entries: MediaEntry[]) => void;
    mocks.categories.mockReturnValue(
      new Promise<MediaEntry[]>((resolve) => {
        complete = resolve;
      }),
    );
    const correcting = useClassificationStore.getState().correctCategories(['a'], ['people']);
    const replacement = { ...review, sessionId: 'session-b', entries: [entry('d')] };
    useClassificationStore.setState({
      review: replacement,
      entries: replacement.entries,
      notice: 'Replacement analysis notice',
    });
    complete(review.entries);
    expect(await correcting).toBe(false);
    useClassificationStore
      .getState()
      .updateCategories('session-a', review.entries, t.correctionsCleared);
    expect(useClassificationStore.getState().entries).toEqual(replacement.entries);
    expect(useClassificationStore.getState().notice).toBe('Replacement analysis notice');
    expect(mocks.loadSettings).not.toHaveBeenCalled();
  });
  it('allows excluded files to be shown, reviewed and selected again without making them removable', async () => {
    useClassificationStore.setState({ selected: ['a', 'b'] });
    useClassificationStore.getState().exclude(['a', 'b']);
    expect(useClassificationStore.getState().selected).toEqual([]);
    expect(useClassificationStore.getState().excluded).toEqual(['a', 'b']);
    useClassificationStore.getState().setShowExcluded(true);
    useClassificationStore.getState().select('a', true);
    useClassificationStore.getState().selectPage(['a', 'b', 'missing'], true);
    useClassificationStore.getState().open('a');
    expect(useClassificationStore.getState().selected).toEqual(['a', 'b']);
    expect(useClassificationStore.getState().activeId).toBe('a');
    await useClassificationStore.getState().remove(['a', 'b']);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('removes protection and exclusion together only after the decision persists, retaining the explicit selection', async () => {
    useClassificationStore.setState({ selected: ['a', 'b'], excluded: ['a', 'b'] });
    mocks.protect.mockRejectedValueOnce({ code: 'DATABASE_ERROR' });
    await useClassificationStore.getState().restoreNormal(['a', 'b']);
    expect(useClassificationStore.getState().excluded).toEqual(['a', 'b']);
    expect(useClassificationStore.getState().entries[1]!.protected).toBe(true);
    const updated = review.entries.map((item) => ({ ...item, protected: false }));
    mocks.protect.mockResolvedValueOnce(updated);
    await useClassificationStore.getState().restoreNormal(['a', 'b']);
    expect(mocks.protect).toHaveBeenLastCalledWith('session-a', ['b'], false);
    expect(useClassificationStore.getState().entries).toEqual(updated);
    expect(useClassificationStore.getState().excluded).toEqual([]);
    expect(useClassificationStore.getState().selected).toEqual(['a', 'b']);
    mocks.remove.mockResolvedValue(operation([['b', 'completed']]));
    await useClassificationStore.getState().remove(['b']);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('session-a', ['b']);
  });
  it('returns exclusions without protection to ordinary files without an unnecessary persistence call', async () => {
    useClassificationStore.setState({ selected: ['a'], excluded: ['a', 'c'] });
    await useClassificationStore.getState().restoreNormal(['a']);
    expect(useClassificationStore.getState().excluded).toEqual(['c']);
    expect(useClassificationStore.getState().selected).toEqual(['a']);
    expect(mocks.protect).not.toHaveBeenCalled();
  });
  it('clears a mixed selection without requiring an unreadable excluded file to be unprotected', async () => {
    const unreadable = {
      ...entry('unreadable'),
      status: 'error' as const,
      error: 'FILE_NOT_FOUND',
    };
    const entries = [unreadable, entry('kept', true)];
    const updated = entries.map((item) => ({ ...item, protected: false }));
    useClassificationStore.setState({
      entries,
      selected: ['unreadable', 'kept'],
      excluded: ['unreadable', 'kept'],
    });
    mocks.protect.mockImplementation(async (_sessionId: string, ids: string[]) => {
      if (ids.includes('unreadable')) throw { code: 'FILE_NOT_FOUND' };
      return updated;
    });
    await useClassificationStore.getState().restoreNormal(['unreadable', 'kept']);
    expect(mocks.protect).toHaveBeenCalledExactlyOnceWith('session-a', ['kept'], false);
    expect(useClassificationStore.getState().excluded).toEqual([]);
    expect(useClassificationStore.getState().entries).toEqual(updated);
    expect(useClassificationStore.getState().selected).toEqual(['unreadable', 'kept']);
    expect(useClassificationStore.getState().error).toBeNull();
  });
  it('does not clear exclusion when an unprotect result arrives for a replaced analysis', async () => {
    let complete!: (entries: MediaEntry[]) => void;
    mocks.protect.mockReturnValue(
      new Promise<MediaEntry[]>((resolve) => {
        complete = resolve;
      }),
    );
    useClassificationStore.setState({ selected: ['b'], excluded: ['b'] });
    const restoring = useClassificationStore.getState().restoreNormal(['b']);
    const replacement = { ...review, sessionId: 'session-b', entries: [entry('d')] };
    useClassificationStore.setState({
      review: replacement,
      entries: replacement.entries,
      excluded: ['d'],
    });
    complete(review.entries.map((item) => ({ ...item, protected: false })));
    await restoring;
    expect(useClassificationStore.getState().entries).toEqual(replacement.entries);
    expect(useClassificationStore.getState().excluded).toEqual(['d']);
  });
  it('hides kept files while reviewing and skips identical copies that were protected by the same decision', async () => {
    const entries = [entry('a'), entry('copy'), entry('c')];
    useClassificationStore.setState({ entries, activeId: 'a', showProtected: false });
    mocks.protect.mockResolvedValue(
      entries.map((item) => ({ ...item, protected: item.id !== 'c' })),
    );
    await useClassificationStore.getState().protect(['a'], true, true);
    expect(useClassificationStore.getState().activeId).toBe('c');
    useClassificationStore.getState().setShowProtected(true);
    useClassificationStore.getState().open('a');
    useClassificationStore.getState().navigate(1);
    expect(useClassificationStore.getState().activeId).toBe('copy');
  });
  it('shows kept files for the Conservar filter and returns to all states when hiding them', () => {
    useClassificationStore.setState({ showProtected: false });
    useClassificationStore.getState().setFilters({ status: 'protected' });
    expect(useClassificationStore.getState().showProtected).toBe(true);
    useClassificationStore.getState().setShowProtected(false);
    expect(useClassificationStore.getState().filters.status).toBe('all');
    useClassificationStore.getState().setFilters({ status: 'excluded' });
    expect(useClassificationStore.getState().showExcluded).toBe(true);
    useClassificationStore.getState().setShowExcluded(false);
    expect(useClassificationStore.getState().filters.status).toBe('all');
  });
  it('bounds accumulated gallery selections to the backend batch limit without partially selecting a page', () => {
    const entries = Array.from({ length: 1_010 }, (_, index) => entry(`item-${index}`));
    useClassificationStore.setState({
      entries,
      selected: entries.slice(0, 1_000).map((item) => item.id),
    });
    useClassificationStore.getState().select('item-1000', true);
    expect(useClassificationStore.getState().selected).toHaveLength(1_000);
    expect(useClassificationStore.getState().error).toContain('1.000 archivos');
    useClassificationStore.getState().selectPage(['item-1000', 'item-1001'], true);
    expect(useClassificationStore.getState().selected).toHaveLength(1_000);
    useClassificationStore.getState().select('item-0', false);
    useClassificationStore.getState().select('item-1000', true);
    expect(useClassificationStore.getState().selected).toContain('item-1000');
  });
  it('never automatically selects classified suggestions or protected files when an analysis completes', async () => {
    useClassificationStore.setState({ selected: ['a'], activeId: 'a' });
    mocks.scan.mockResolvedValue(review);
    await useClassificationStore.getState().scan();
    expect(useClassificationStore.getState().entries).toEqual(review.entries);
    expect(useClassificationStore.getState().selected).toEqual([]);
    expect(useClassificationStore.getState().activeId).toBeNull();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
  it('captures a removal selection, excludes protected files and blocks changes until it finishes', async () => {
    let complete!: (value: Operation) => void;
    mocks.remove.mockReturnValue(
      new Promise<Operation>((resolve) => {
        complete = resolve;
      }),
    );
    useClassificationStore.setState({ selected: ['a', 'b'], activeId: 'a' });
    const removal = useClassificationStore.getState().remove(['a', 'b']);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('session-a', ['a']);
    useClassificationStore.getState().select('c', true);
    useClassificationStore.getState().navigate(1);
    await useClassificationStore.getState().protect(['a'], true);
    expect(useClassificationStore.getState().selected).toEqual(['a', 'b']);
    expect(useClassificationStore.getState().activeId).toBe('a');
    expect(mocks.protect).not.toHaveBeenCalled();
    complete(operation([['a', 'completed']]));
    await removal;
    expect(useClassificationStore.getState().entries.map((item) => item.id)).toEqual(['b', 'c']);
    expect(useClassificationStore.getState().activeId).toBe('b');
    expect(useClassificationStore.getState().selected).toEqual(['b']);
    expect(mocks.workflow.busy).toBe(false);
    expect(mocks.workflow.loadHistory).toHaveBeenCalledOnce();
  });
  it('keeps failed files selected after a partial operation and reports the limitation', async () => {
    useClassificationStore.setState({ selected: ['a', 'c'] });
    mocks.remove.mockResolvedValue(
      operation([
        ['a', 'completed'],
        ['c', 'failed'],
      ]),
    );
    await useClassificationStore.getState().remove(['a', 'c']);
    expect(useClassificationStore.getState().entries.map((item) => item.id)).toEqual(['b', 'c']);
    expect(useClassificationStore.getState().selected).toEqual(['c']);
    expect(useClassificationStore.getState().error).toContain('Algunos archivos');
    expect(useClassificationStore.getState().lastOperationId).toBe('operation');
  });
  it('does not retire or claim success when no history item completed', async () => {
    mocks.remove.mockResolvedValue(operation([['a', 'failed']]));
    await useClassificationStore.getState().remove(['a']);
    expect(useClassificationStore.getState().entries).toEqual(review.entries);
    expect(useClassificationStore.getState().lastOperationId).toBeNull();
    expect(useClassificationStore.getState().error).toContain('No se retiró ningún archivo');
    expect(mocks.clearPreviews).not.toHaveBeenCalled();
  });
  it('updates protection for identical copies returned by the backend and advances only after persistence succeeds', async () => {
    useClassificationStore.setState({ selected: ['a', 'c'], activeId: 'a' });
    mocks.protect.mockRejectedValueOnce({ code: 'DATABASE_ERROR' });
    await useClassificationStore.getState().protect(['a'], true, true);
    expect(useClassificationStore.getState().activeId).toBe('a');
    expect(useClassificationStore.getState().entries[0]!.protected).toBe(false);
    const updated = review.entries.map((item) => ({ ...item, protected: true }));
    mocks.protect.mockResolvedValueOnce(updated);
    await useClassificationStore.getState().protect(['a'], true, true);
    expect(useClassificationStore.getState().entries).toEqual(updated);
    expect(useClassificationStore.getState().activeId).toBe('b');
    expect(useClassificationStore.getState().selected).toEqual(['c']);
    await useClassificationStore.getState().remove(['c']);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('skips identical copies newly protected under the available filter and closes at the end', async () => {
    const entries = [entry('a'), entry('identical-copy'), entry('c')];
    useClassificationStore.setState({
      review: { ...review, entries },
      entries,
      activeId: 'a',
      filters: { ...emptyMediaFilters, status: 'available' },
    });
    const protectedCopies = entries.map((item) => ({ ...item, protected: item.id !== 'c' }));
    mocks.protect.mockResolvedValueOnce(protectedCopies);
    await useClassificationStore.getState().protect(['a'], true, true);
    expect(useClassificationStore.getState().activeId).toBe('c');
    expect(useClassificationStore.getState().entries[1]!.protected).toBe(true);
    mocks.protect.mockResolvedValueOnce(entries.map((item) => ({ ...item, protected: true })));
    await useClassificationStore.getState().protect(['c'], true, true);
    expect(useClassificationStore.getState().activeId).toBeNull();
  });
  it('does not apply a late operation result to a replacement session', async () => {
    let complete!: (value: Operation) => void;
    mocks.remove.mockReturnValue(
      new Promise<Operation>((resolve) => {
        complete = resolve;
      }),
    );
    const removal = useClassificationStore.getState().remove(['a']);
    const replacement = { ...review, sessionId: 'session-b', entries: [entry('d')] };
    useClassificationStore.setState({ review: replacement, entries: replacement.entries });
    complete(operation([['a', 'completed']]));
    await removal;
    expect(useClassificationStore.getState().entries.map((item) => item.id)).toEqual(['d']);
    expect(useClassificationStore.getState().lastOperationId).toBeNull();
  });
  it('keeps completed partial results reviewable after a cancelled analysis', async () => {
    mocks.scan.mockResolvedValue({ ...review, cancelled: true, entries: [entry('a')] });
    await useClassificationStore.getState().scan();
    expect(useClassificationStore.getState().entries.map((item) => item.id)).toEqual(['a']);
    expect(useClassificationStore.getState().notice).toContain('Análisis cancelado');
    expect(useClassificationStore.getState().selected).toEqual([]);
    expect(mocks.workflow.busy).toBe(false);
  });
  it('does not start a scan when cancellation happens while its event subscription is being registered', async () => {
    let subscribed!: (value: () => void) => void;
    mocks.listen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        subscribed = resolve;
      }),
    );
    const scan = useClassificationStore.getState().scan();
    await useClassificationStore.getState().cancel();
    expect(mocks.workflow.cancel).toHaveBeenCalledOnce();
    subscribed(mocks.unlisten);
    await scan;
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(useClassificationStore.getState().review).toBeNull();
    expect(mocks.workflow.busy).toBe(false);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});
