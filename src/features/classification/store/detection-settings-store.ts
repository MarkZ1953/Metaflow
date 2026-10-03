import { create } from 'zustand';
import {
  classificationService,
  defaultClassificationSettings,
  type ClassificationSettings,
  type ClassificationSettingsSnapshot,
  type MediaEntry,
} from '../services/classification-service';
import { classificationError } from '../services/classification-error';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';

interface DetectionSettingsState {
  snapshot: ClassificationSettingsSnapshot;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
  load(refresh?: boolean): Promise<void>;
  save(change: Partial<ClassificationSettings>): Promise<void>;
  clearCorrections(): Promise<MediaEntry[] | null>;
}

export const useDetectionSettingsStore = create<DetectionSettingsState>((set, get) => {
  let sequence = 0;
  let loadingRead = false;
  const persist = async (action: () => Promise<ClassificationSettingsSnapshot>, notice: string) => {
    if (get().loading || useWorkflowStore.getState().busy) return false;
    const current = ++sequence;
    set({ loading: true, error: null, notice: null });
    useWorkflowStore.setState({ busy: true });
    try {
      const snapshot = await action();
      if (current === sequence) {
        set({ snapshot, loaded: true, notice });
        return true;
      }
    } catch (error) {
      if (current === sequence) set({ error: classificationError(error) });
    } finally {
      if (current === sequence) {
        set({ loading: false });
        useWorkflowStore.setState({ busy: false });
      }
    }
    return false;
  };
  return {
    snapshot: { settings: { ...defaultClassificationSettings }, correctionCount: 0 },
    loading: false,
    loaded: false,
    error: null,
    notice: null,
    async load(refresh = false) {
      if (get().loading && (!refresh || !loadingRead)) return;
      const current = ++sequence;
      loadingRead = true;
      set({ loading: true, error: null });
      try {
        const snapshot = await classificationService.loadSettings();
        if (current === sequence) set({ snapshot, loaded: true });
      } catch (error) {
        if (current === sequence) set({ error: classificationError(error) });
      } finally {
        if (current === sequence) {
          loadingRead = false;
          set({ loading: false });
        }
      }
    },
    async save(change) {
      if (!get().loaded) return;
      const settings = { ...get().snapshot.settings, ...change };
      await persist(() => classificationService.saveSettings(settings), t.settingsSaved);
    },
    async clearCorrections() {
      if (!get().loaded || !get().snapshot.correctionCount) return null;
      let entries: MediaEntry[] = [];
      const success = await persist(async () => {
        const response = await classificationService.clearCorrections();
        entries = response.entries;
        return response.configuration;
      }, t.correctionsCleared);
      return success ? entries : null;
    },
  };
});
