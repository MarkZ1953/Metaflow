import { create } from 'zustand';
import { renameService, type RenameConfiguration } from '../services/rename-service';
import { friendlyError } from '../../../shared/services/app-error';
interface RenameState {
  configuration: RenameConfiguration;
  error: string | null;
  loading: boolean;
  load(): Promise<void>;
  save(configuration: RenameConfiguration): Promise<boolean>;
}
export const useRenameStore = create<RenameState>((set) => ({
  configuration: { presets: [], inboxPresetId: null, rulePresets: {} },
  error: null,
  loading: false,
  async load() {
    try {
      set({ configuration: await renameService.load() });
    } catch (error) {
      set({ error: friendlyError(error) });
    }
  },
  async save(configuration) {
    set({ loading: true, error: null });
    try {
      set({ configuration: await renameService.save(configuration) });
      return true;
    } catch (error) {
      set({ error: friendlyError(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },
}));
