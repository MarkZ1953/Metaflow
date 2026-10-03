import { create } from 'zustand';
import { friendlyError } from '../../../shared/services/app-error';
import { nativeExplorerService } from '../services/explorer-service';
import type { ExplorerService } from '../services/explorer-service';
import type {
  AuthorizedFolder,
  CategoryFilter,
  DirectoryListing,
  FileEntry,
  SortDirection,
  SortField,
} from '../types/explorer-types';

interface ExplorerState {
  folders: AuthorizedFolder[];
  listing: DirectoryListing | null;
  selected: FileEntry | null;
  selectedPaths: string[];
  query: string;
  category: CategoryFilter;
  sortField: SortField;
  sortDirection: SortDirection;
  extension: string;
  minimumSize: number | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  picking: boolean;
  error: string | null;
  failedPath: string | null;
  history: string[];
  historyIndex: number;
  demo: boolean;
  pickFolder: () => Promise<void>;
  navigate: (path: string, historyIndex?: number) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  up: () => Promise<void>;
  refresh: () => Promise<void>;
  forgetFolder: (path: string) => Promise<void>;
  select: (entry: FileEntry | null) => void;
  selectPaths: (paths: string[], entry?: FileEntry) => void;
  resetNavigation: () => void;
  setQuery: (query: string) => void;
  setCategory: (category: CategoryFilter) => void;
  setSort: (field: SortField) => void;
  setDirection: (direction: SortDirection) => void;
  setFilters: (extension: string, minimumSize: number | null) => void;
  clearFilters: () => void;
  clearError: () => void;
  startDemo: () => Promise<void>;
}

export function createExplorerStore(initialService: ExplorerService = nativeExplorerService) {
  let service = initialService;
  let requestId = 0;
  return create<ExplorerState>((set, get) => ({
    folders: [],
    listing: null,
    selected: null,
    selectedPaths: [],
    query: '',
    category: 'all',
    sortField: 'name',
    sortDirection: 'asc',
    extension: '',
    minimumSize: null,
    status: 'idle',
    picking: false,
    error: null,
    failedPath: null,
    history: [],
    historyIndex: -1,
    demo: false,
    async pickFolder() {
      if (get().picking) return;
      set({ picking: true, error: null });
      try {
        const folder = await service.pickFolder();
        if (!folder) return;
        if (!get().folders.some((item) => item.path === folder.path)) {
          set({ folders: [...get().folders, folder] });
        }
        await get().navigate(folder.path);
      } catch (error) {
        set({ error: friendlyError(error) });
      } finally {
        set({ picking: false });
      }
    },
    async navigate(path, targetIndex) {
      const currentRequest = ++requestId;
      set({ status: 'loading', error: null, failedPath: null });
      try {
        const listing = await service.readDirectory(path);
        if (currentRequest !== requestId) return;
        const state = get();
        const samePath = listing.path === state.listing?.path;
        const history =
          targetIndex !== undefined || samePath
            ? state.history
            : [...state.history.slice(0, state.historyIndex + 1), listing.path];
        set({
          listing,
          selectedPaths: samePath
            ? state.selectedPaths.filter((path) => listing.entries.some((e) => e.path === path))
            : [],
          status: 'ready',
          selected: samePath
            ? (listing.entries.find((entry) => entry.path === state.selected?.path) ?? null)
            : null,
          history,
          historyIndex: targetIndex ?? (samePath ? state.historyIndex : history.length - 1),
          ...(!samePath ? { query: '', extension: '', minimumSize: null } : {}),
        });
      } catch (error) {
        if (currentRequest === requestId)
          set({ status: 'error', error: friendlyError(error), failedPath: path });
      }
    },
    async back() {
      const state = get();
      const path = state.history[state.historyIndex - 1];
      if (path) await get().navigate(path, state.historyIndex - 1);
    },
    async forward() {
      const state = get();
      const path = state.history[state.historyIndex + 1];
      if (path) await get().navigate(path, state.historyIndex + 1);
    },
    async up() {
      const path = get().listing?.parentPath;
      if (path) await get().navigate(path);
    },
    async refresh() {
      const path = get().failedPath ?? get().listing?.path;
      if (path) await get().navigate(path);
    },
    async forgetFolder(path) {
      try {
        await service.forgetFolder(path);
        ++requestId; // Discard a read that was started before revocation.
        const state = get();
        const folders = state.folders.filter((folder) => folder.path !== path);
        set({
          folders,
          history: [],
          historyIndex: -1,
          ...(state.listing?.rootPath === path
            ? { listing: null, selected: null, status: 'idle', error: null }
            : { status: state.listing ? 'ready' : 'idle' }),
        });
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },
    select: (selected) => set({ selected, selectedPaths: selected ? [selected.path] : [] }),
    selectPaths: (selectedPaths, entry) =>
      set({ selectedPaths, ...(entry ? { selected: entry } : {}) }),
    resetNavigation: () => {
      ++requestId;
      set({
        listing: null,
        selected: null,
        selectedPaths: [],
        status: 'idle',
        error: null,
        failedPath: null,
        history: [],
        historyIndex: -1,
      });
    },
    setQuery: (query) => set({ query }),
    setCategory: (category) => set({ category, selected: null, selectedPaths: [] }),
    setSort: (field) =>
      set((state) => ({
        sortField: field,
        sortDirection: state.sortField === field && state.sortDirection === 'asc' ? 'desc' : 'asc',
      })),
    setDirection: (sortDirection) => set({ sortDirection }),
    setFilters: (extension, minimumSize) => set({ extension, minimumSize }),
    clearFilters: () => set({ query: '', category: 'all', extension: '', minimumSize: null }),
    clearError: () => set({ error: null }),
    async startDemo() {
      if (!import.meta.env.DEV) return;
      const { demoService } = await import('../services/demo-service');
      ++requestId;
      service = demoService;
      set({
        folders: [],
        listing: null,
        history: [],
        historyIndex: -1,
        selected: null,
        demo: true,
      });
      await get().pickFolder();
    },
  }));
}

export const useExplorerStore = createExplorerStore();
