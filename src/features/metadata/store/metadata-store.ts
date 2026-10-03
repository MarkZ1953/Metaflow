import { create } from 'zustand';
import { metadataService, type MetadataRequest } from '../services/metadata-service';
import type { OrganizationPlan } from '../../inbox/schemas/inbox-schema';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { friendlyError } from '../../../shared/services/app-error';
import { metadataMessages as t } from '../../../shared/constants/metadata-messages';
interface MetadataState {
  open: boolean;
  plan: OrganizationPlan | null;
  request: MetadataRequest | null;
  error: string | null;
  preview(request: MetadataRequest): Promise<void>;
  execute(): Promise<void>;
  close(): void;
}
export const useMetadataStore = create<MetadataState>((set, get) => ({
  open: false,
  plan: null,
  request: null,
  error: null,
  async preview(request) {
    if (useWorkflowStore.getState().busy) return;
    useWorkflowStore.setState({ busy: true });
    set({ open: true, request, plan: null, error: null });
    try {
      set({ plan: await metadataService.preview(request) });
    } catch (error) {
      set({ error: friendlyError(error) });
    } finally {
      useWorkflowStore.setState({ busy: false });
    }
  },
  async execute() {
    const plan = get().plan;
    if (!plan || useWorkflowStore.getState().busy) return;
    useWorkflowStore.setState({
      busy: true,
      progress: { operationId: '', completed: 0, total: plan.items.length, phase: 'dates' },
    });
    try {
      await metadataService.execute(plan.id);
      set({ open: false, plan: null, request: null });
      await useExplorerStore.getState().refresh();
      await useWorkflowStore.getState().loadHistory();
      await useWorkflowStore.getState().refresh();
      useWorkflowStore.setState({ page: 'history', notice: t.done });
    } catch (error) {
      set({ error: friendlyError(error), plan: null });
      await useWorkflowStore.getState().loadHistory();
    } finally {
      useWorkflowStore.setState({ busy: false, progress: null });
    }
  },
  close() {
    if (!useWorkflowStore.getState().busy)
      set({ open: false, plan: null, request: null, error: null });
  },
}));
