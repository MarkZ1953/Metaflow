import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  workflow: { busy: false },
}));
vi.mock('../services/classification-service', async (original) => ({
  ...(await original<typeof import('../services/classification-service')>()),
  classificationService: {
    loadSettings: mocks.load,
    saveSettings: mocks.save,
    clearCorrections: mocks.clear,
  },
}));
vi.mock('../../inbox/store/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => mocks.workflow,
    setState: (value: Record<string, unknown>) => Object.assign(mocks.workflow, value),
  },
}));
import { defaultClassificationSettings } from '../services/classification-service';
import { useDetectionSettingsStore } from './detection-settings-store';
const snapshot = {
  settings: { ...defaultClassificationSettings },
  correctionCount: 2,
  ocrAvailable: true,
  ocrLanguages: ['es'],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workflow.busy = false;
  useDetectionSettingsStore.setState({
    snapshot,
    loading: false,
    loaded: true,
    error: null,
    notice: null,
  });
});
describe('Persistent detection controls', () => {
  it('refreshes example counts after a correction without accepting the stale initial settings read', async () => {
    let complete!: (value: typeof snapshot) => void;
    mocks.load.mockReturnValueOnce(
      new Promise<typeof snapshot>((resolve) => {
        complete = resolve;
      }),
    );
    mocks.load.mockResolvedValueOnce({ ...snapshot, correctionCount: 3 });
    const initial = useDetectionSettingsStore.getState().load();
    await useDetectionSettingsStore.getState().load(true);
    expect(useDetectionSettingsStore.getState().snapshot.correctionCount).toBe(3);
    complete({ ...snapshot, correctionCount: 0 });
    await initial;
    expect(useDetectionSettingsStore.getState().snapshot.correctionCount).toBe(3);
    expect(useDetectionSettingsStore.getState().loading).toBe(false);
  });
  it('keeps an unrelated running analysis busy when a read-only settings load completes, and blocks writes during that analysis', async () => {
    mocks.workflow.busy = true;
    mocks.load.mockResolvedValue(snapshot);
    await useDetectionSettingsStore.getState().load();
    await useDetectionSettingsStore.getState().save({ readText: false });
    await useDetectionSettingsStore.getState().clearCorrections();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.workflow.busy).toBe(true);
  });
  it('does not claim a setting was saved when persistence fails, and blocks gallery operations until saving finishes', async () => {
    let reject!: (error: unknown) => void;
    mocks.save.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const saving = useDetectionSettingsStore.getState().save({ sensitivity: 'broad' });
    expect(mocks.workflow.busy).toBe(true);
    await useDetectionSettingsStore.getState().load(true);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(useDetectionSettingsStore.getState().snapshot.settings.sensitivity).toBe('balanced');
    await useDetectionSettingsStore.getState().clearCorrections();
    expect(mocks.clear).not.toHaveBeenCalled();
    reject({ code: 'DATABASE_ERROR' });
    await saving;
    expect(mocks.workflow.busy).toBe(false);
    expect(useDetectionSettingsStore.getState().snapshot.settings.sensitivity).toBe('balanced');
    expect(useDetectionSettingsStore.getState().notice).toBeNull();
    expect(useDetectionSettingsStore.getState().error).toBeTruthy();
  });
  it('saves a partial setting while retaining the other persisted choices', async () => {
    const updated = {
      ...snapshot,
      settings: { ...snapshot.settings, sensitivity: 'conservative' as const },
    };
    mocks.save.mockResolvedValue(updated);
    await useDetectionSettingsStore.getState().save({ sensitivity: 'conservative' });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(updated.settings);
    expect(useDetectionSettingsStore.getState().snapshot).toEqual(updated);
    expect(useDetectionSettingsStore.getState().notice).toContain('Vuelve a analizar');
  });
  it('exposes reset entries only after the examples were cleared successfully', async () => {
    mocks.clear.mockRejectedValueOnce({ code: 'DATABASE_ERROR' });
    expect(await useDetectionSettingsStore.getState().clearCorrections()).toBeNull();
    expect(useDetectionSettingsStore.getState().snapshot.correctionCount).toBe(2);
    const configuration = { ...snapshot, correctionCount: 0 };
    mocks.clear.mockResolvedValueOnce({ configuration, entries: [] });
    expect(await useDetectionSettingsStore.getState().clearCorrections()).toEqual([]);
    expect(useDetectionSettingsStore.getState().snapshot.correctionCount).toBe(0);
    expect(mocks.workflow.busy).toBe(false);
  });
});
