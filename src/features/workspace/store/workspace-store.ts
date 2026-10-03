import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { create } from 'zustand';
import {
  workspaceService,
  type Workspace,
  type TransferRequest,
} from '../services/workspace-service';
import { nativeExplorerService } from '../../explorer/services/explorer-service';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import type { FileEntry } from '../../explorer/types/explorer-types';
import type { OrganizationPlan } from '../../inbox/schemas/inbox-schema';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { friendlyError } from '../../../shared/services/app-error';
import { duplicateService } from '../../duplicates/services/duplicate-service';
interface WorkspaceState {
  cleanup: boolean;
  workspace: Workspace;
  children: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  error: string | null;
  request: TransferRequest | null;
  plan: OrganizationPlan | null;
  pendingSources: string[];
  pendingDestination: string;
  pendingMode: 'move' | 'copy';
  load(): Promise<void>;
  add(): Promise<void>;
  remove(id: string): Promise<void>;
  favorite(path: string): Promise<void>;
  expand(path: string, refresh?: boolean): Promise<void>;
  navigate(path: string): Promise<void>;
  newFolder(parent: string, name: string): Promise<void>;
  openLocation(path: string): Promise<void>;
  prepare(sources: string[], destination?: string, mode?: 'move' | 'copy'): void;
  close(): void;
  preview(request: TransferRequest): Promise<void>;
  execute(): Promise<void>;
}
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  cleanup: false,
  workspace: { id: 'default', name: w.metaflowWorkspace, roots: [], favorites: [] },
  children: {},
  expanded: {},
  loading: {},
  error: null,
  request: null,
  plan: null,
  pendingSources: [],
  pendingDestination: '',
  pendingMode: 'move',
  async load() {
    try {
      const workspace = await workspaceService.load();
      set({ workspace });
      useExplorerStore.setState({ folders: workspace.roots });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  async add() {
    if (useWorkflowStore.getState().busy) return;
    useWorkflowStore.setState({ busy: true });
    try {
      const workspace = await workspaceService.add();
      set({ workspace, error: null });
      useExplorerStore.setState({ folders: workspace.roots });
      const added = workspace.roots.at(-1);
      if (added) await get().navigate(added.path);
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      useWorkflowStore.setState({ busy: false });
    }
  },
  async remove(id) {
    try {
      set({ workspace: await workspaceService.remove(id), children: {}, expanded: {} });
      useExplorerStore.getState().resetNavigation();
      useExplorerStore.setState({
        folders: get().workspace.roots,
        listing: null,
        selected: null,
        selectedPaths: [],
      });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  async favorite(path) {
    try {
      set({
        workspace: await workspaceService.favorite(path, !get().workspace.favorites.includes(path)),
      });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  async expand(path, refresh = false) {
    if (get().loading[path]) return;
    if (get().expanded[path] && !refresh) {
      set((s) => ({ expanded: { ...s.expanded, [path]: false } }));
      return;
    }
    set((s) => ({
      expanded: { ...s.expanded, [path]: true },
      loading: { ...s.loading, [path]: true },
    }));
    try {
      if (!get().children[path] || refresh) {
        const listing = await nativeExplorerService.readDirectory(path);
        set((s) => ({
          children: {
            ...s.children,
            [path]: listing.entries.filter((e) => e.kind === 'directory'),
          },
        }));
      }
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set((s) => ({ loading: { ...s.loading, [path]: false } }));
    }
  },
  async navigate(path) {
    useWorkflowStore.getState().setPage('workspace');
    await useExplorerStore.getState().navigate(path);
  },
  async newFolder(parent, name) {
    try {
      await workspaceService.newFolder(parent, name);
      await get().expand(parent, true);
      await useExplorerStore.getState().refresh();
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  async openLocation(path) {
    try {
      await workspaceService.openLocation(path);
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  prepare(sources, destination = '', mode = 'move') {
    if (!sources.length || useWorkflowStore.getState().busy) return;
    set({
      pendingSources: sources,
      pendingDestination: destination,
      pendingMode: mode,
      cleanup: false,
      plan: null,
      request: null,
      error: null,
    });
  },
  close() {
    if (!useWorkflowStore.getState().busy)
      set({ pendingSources: [], plan: null, request: null, error: null });
  },
  async preview(request) {
    if (useWorkflowStore.getState().busy) return;
    useWorkflowStore.setState({ busy: true });
    try {
      set({ request, plan: await workspaceService.preview(request), error: null });
    } catch (error) {
      set({ error: friendlyError(error), plan: null });
    } finally {
      useWorkflowStore.setState({ busy: false });
    }
  },
  async execute() {
    const plan = get().plan;
    if (!plan || useWorkflowStore.getState().busy) return;
    useWorkflowStore.setState({
      busy: true,
      progress: {
        operationId: '',
        completed: 0,
        total: plan.items.length,
        phase: get().request?.mode ?? 'move',
      },
    });
    try {
      await (get().cleanup ? duplicateService.execute(plan.id) : workspaceService.execute(plan.id));
      set({ plan: null, pendingSources: [], request: null, children: {}, expanded: {} });
      await get().load();
      await useExplorerStore.getState().refresh();
      await useWorkflowStore.getState().loadHistory();
      await useWorkflowStore.getState().refresh();
      useWorkflowStore.setState({
        page: 'history',
        notice: w.transferenciaFinalizadaRevisaLosResultadosDelLote,
      });
    } catch (error) {
      set({ error: friendlyError(error), plan: null });
      await useWorkflowStore.getState().loadHistory();
    } finally {
      useWorkflowStore.setState({ busy: false, progress: null });
    }
  },
}));
