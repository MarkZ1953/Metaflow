import { create } from 'zustand';
import { desktopWorkflow, isDesktop, type WorkflowService } from '../services/inbox-service';
import type {
  InboxSnapshot,
  DateRule,
  OrganizationPlan,
  Operation,
  BatchProgress,
  ConflictPolicy,
  IssueResolution,
} from '../schemas/inbox-schema';
import { friendlyError } from '../../../shared/services/app-error';
import { messages as t } from '../../../shared/constants/messages';

const empty: InboxSnapshot = {
  inbox: null,
  rules: [],
  files: [],
  watcherStatus: 'idle',
  error: null,
};
export type Page =
  | 'inbox'
  | 'review'
  | 'rules'
  | 'history'
  | 'workspace'
  | 'transfers'
  | 'presets'
  | 'duplicates'
  | 'metadata';
interface WorkflowState {
  snapshot: InboxSnapshot;
  page: Page;
  query: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  plan: OrganizationPlan | null;
  history: Operation[];
  progress: BatchProgress | null;
  demo: boolean;
  policy: ConflictPolicy;
  duplicateAction: string;
  resolutions: Record<string, IssueResolution>;
  setPage(page: Page): void;
  setQuery(query: string): void;
  dismissError(): void;
  dismissNotice(): void;
  refresh(): Promise<void>;
  chooseInbox(): Promise<void>;
  saveRules(rules: DateRule[]): Promise<boolean>;
  chooseDestination(): Promise<string | null>;
  retry(): Promise<void>;
  preview(
    policy?: ConflictPolicy,
    duplicateAction?: string,
    resolutions?: Record<string, IssueResolution>,
  ): Promise<void>;
  closePlan(): void;
  execute(): Promise<void>;
  loadHistory(): Promise<void>;
  undo(id: string): Promise<void>;
  cancel(): Promise<void>;
  setProgress(progress: BatchProgress): void;
  startDemo(): Promise<void>;
}
let service: WorkflowService = desktopWorkflow;
let refreshSequence = 0;
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  snapshot: empty,
  page: 'inbox',
  query: '',
  loading: isDesktop,
  busy: false,
  error: null,
  notice: null,
  plan: null,
  history: [],
  progress: null,
  demo: false,
  policy: 'skip',
  duplicateAction: 'skip',
  resolutions: {},
  setPage: (page) => {
    set({ page, query: '' });
    if (page === 'history') void get().loadHistory();
  },
  setQuery: (query) => set({ query }),
  dismissError: () => set({ error: null }),
  dismissNotice: () => set({ notice: null }),
  refresh: async () => {
    if (!isDesktop && !get().demo) return;
    const sequence = ++refreshSequence;
    try {
      const snapshot = await service.snapshot();
      if (sequence === refreshSequence) set({ snapshot, loading: false });
    } catch (error) {
      if (sequence === refreshSequence) set({ error: friendlyError(error), loading: false });
    }
  },
  chooseInbox: async () => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      set({ snapshot: await service.chooseInbox(), plan: null, page: 'inbox' });
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      set({ busy: false });
    }
  },
  saveRules: async (rules) => {
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      set({ snapshot: await service.saveRules(rules), plan: null });
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  chooseDestination: async () => {
    try {
      return await service.chooseDestination();
    } catch (error) {
      set({ error: friendlyError(error) });
      return null;
    }
  },
  retry: async () => {
    try {
      set({ snapshot: await service.retry() });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  preview: async (
    policy = get().policy,
    duplicateAction = get().duplicateAction,
    resolutions = get().resolutions,
  ) => {
    if (get().busy) return;
    set({ busy: true, error: null, policy, duplicateAction, resolutions });
    try {
      set({ plan: await service.preview(policy, duplicateAction, resolutions) });
    } catch (error) {
      set({ error: friendlyError(error), plan: null });
    } finally {
      set({ busy: false });
    }
  },
  closePlan: () => {
    if (!get().busy) set({ plan: null });
  },
  execute: async () => {
    const plan = get().plan;
    if (!plan || get().busy || get().demo) return;
    set({
      busy: true,
      error: null,
      progress: { operationId: '', completed: 0, total: plan.items.length, phase: 'move' },
    });
    try {
      await service.execute(plan.id);
      set({ plan: null, page: 'history', notice: t.complete });
      await get().loadHistory();
      await get().refresh();
    } catch (error) {
      set({ error: friendlyError(error), plan: null });
      await get().loadHistory();
    } finally {
      set({ busy: false, progress: null });
    }
  },
  loadHistory: async () => {
    if (!isDesktop && !get().demo) return;
    try {
      set({ history: await service.history() });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  undo: async (id) => {
    if (get().busy || get().demo) return;
    set({
      busy: true,
      error: null,
      progress: { operationId: id, completed: 0, total: 0, phase: 'undo' },
    });
    try {
      await service.undo(id);
      set({ notice: t.complete });
      await get().loadHistory();
      await get().refresh();
    } catch (error) {
      set({ error: friendlyError(error) });
      await get().loadHistory();
    } finally {
      set({ busy: false, progress: null });
    }
  },
  cancel: async () => {
    try {
      await service.cancel();
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  setProgress: (progress) => {
    if (get().busy) set({ progress });
  },
  startDemo: async () => {
    if (!import.meta.env.DEV) return;
    const { createWorkflowDemo } = await import('../services/workflow-demo');
    service = createWorkflowDemo();
    set({ demo: true, loading: false });
    await get().refresh();
  },
}));
