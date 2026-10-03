import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import {
  classificationService,
  mediaPreviewSchema,
  mediaScanSchema,
  defaultClassificationSettings,
  classificationSettingsSnapshotSchema,
} from './classification-service';
const entry = {
  id: 'image-a',
  path: 'F:\\Fotos\\a.jpg',
  name: 'a.jpg',
  stamp: { size: 20, createdAt: null, modifiedAt: 1 },
  kind: 'image',
  labels: [
    { category: 'people', score: 0.8 },
    { category: 'memes', score: 0.6 },
  ],
  protected: false,
  uncertain: false,
  status: 'classified',
  error: null,
};
const scan = {
  sessionId: 'session',
  entries: [entry],
  unreadableCount: 0,
  skippedCount: 0,
  truncated: false,
  cancelled: false,
  modelVersion: 'local-v1',
};
const frame = {
  dataUrl: 'data:image/jpeg;base64,/9j/AA==',
  width: 800,
  height: 600,
  atSeconds: null,
};
beforeEach(() => mock.invoke.mockReset());
describe('Local media classification IPC contracts', () => {
  it('accepts a cancelled folder picker and validates authorized folder results', async () => {
    mock.invoke
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ path: 'G:\\SoloFotos', name: 'SoloFotos' }])
      .mockResolvedValueOnce([{ path: 'G:\\SoloFotos' }])
      .mockResolvedValueOnce(
        Array.from({ length: 33 }, (_, index) => ({ path: `G:\\${index}`, name: `${index}` })),
      );
    expect(await classificationService.selectFolders()).toEqual([]);
    expect(await classificationService.selectFolders()).toEqual([
      { path: 'G:\\SoloFotos', name: 'SoloFotos' },
    ]);
    await expect(classificationService.selectFolders()).rejects.toThrow();
    await expect(classificationService.selectFolders()).rejects.toThrow();
    expect(mock.invoke).toHaveBeenCalledWith('select_classification_folders');
  });
  it('preserves explicit multiple-folder, empty selection and whole Workspace scopes in IPC', async () => {
    mock.invoke.mockResolvedValue(scan);
    const selected = {
      folderPath: null,
      folderPaths: ['G:\\SoloFotos', 'H:\\Viajes'],
      recursive: false,
      includeVideos: false,
    };
    await classificationService.scan(selected);
    await classificationService.scan({ ...selected, folderPaths: [] });
    await classificationService.scan({ ...selected, folderPaths: null });
    expect(mock.invoke).toHaveBeenNthCalledWith(1, 'scan_classification_review', selected);
    expect(mock.invoke).toHaveBeenNthCalledWith(2, 'scan_classification_review', {
      ...selected,
      folderPaths: [],
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(3, 'scan_classification_review', {
      ...selected,
      folderPaths: null,
    });
  });
  it('accepts OCR availability and manual correction provenance without inventing model certainty', () => {
    const snapshot = classificationSettingsSnapshotSchema.parse({
      settings: defaultClassificationSettings,
      correctionCount: 3,
      ocrAvailable: false,
      ocrLanguages: [],
    });
    expect(snapshot.ocrAvailable).toBe(false);
    const result = mediaScanSchema.parse({
      ...scan,
      entries: [
        { ...entry, corrected: true, learned: false, labels: [{ category: 'people', score: 0 }] },
      ],
    });
    expect(result.entries[0]!.corrected).toBe(true);
    expect(result.entries[0]!.labels[0]!.score).toBe(0);
    expect(
      classificationSettingsSnapshotSchema.safeParse({
        settings: { ...defaultClassificationSettings, sensitivity: 'certain' },
        correctionCount: 0,
      }).success,
    ).toBe(false);
  });
  it('passes category corrections and settings through their native contracts and parses reset gallery results', async () => {
    mock.invoke.mockClear();
    const configuration = {
      settings: defaultClassificationSettings,
      correctionCount: 0,
      ocrAvailable: true,
      ocrLanguages: ['es'],
    };
    mock.invoke
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce(configuration)
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce({ configuration, entries: [entry] });
    await classificationService.loadSettings();
    await classificationService.saveSettings(defaultClassificationSettings);
    await classificationService.categories('session', ['image-a'], ['memes', 'people']);
    await classificationService.categories('session', ['image-a'], null);
    const cleared = await classificationService.clearCorrections();
    expect(mock.invoke).toHaveBeenNthCalledWith(1, 'load_classification_settings');
    expect(mock.invoke).toHaveBeenNthCalledWith(2, 'save_classification_settings', {
      settings: defaultClassificationSettings,
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(3, 'set_classification_categories', {
      sessionId: 'session',
      itemIds: ['image-a'],
      categories: ['memes', 'people'],
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(4, 'set_classification_categories', {
      sessionId: 'session',
      itemIds: ['image-a'],
      categories: null,
    });
    expect(cleared.entries).toEqual([entry]);
    expect(cleared.configuration.correctionCount).toBe(0);
    mock.invoke.mockClear();
  });
  it('accepts overlapping suggestions, persistent protection and partial cancelled scans', () => {
    const result = mediaScanSchema.parse({
      ...scan,
      cancelled: true,
      entries: [{ ...entry, protected: true, uncertain: true }],
    });
    expect(result.entries[0]!.labels.map((label) => label.category)).toEqual(['people', 'memes']);
    expect(result.entries[0]!.protected).toBe(true);
    expect(result.cancelled).toBe(true);
  });
  it('rejects an unknown category or a score outside the relative affinity range', () => {
    expect(
      mediaScanSchema.safeParse({
        ...scan,
        entries: [{ ...entry, labels: [{ category: 'trash', score: 0.9 }] }],
      }).success,
    ).toBe(false);
    expect(
      mediaScanSchema.safeParse({
        ...scan,
        entries: [{ ...entry, labels: [{ category: 'people', score: 1.2 }] }],
      }).success,
    ).toBe(false);
  });
  it.each([
    'https://example.com/photo.jpg',
    'file:///C:/private/photo.jpg',
    'data:image/svg+xml;base64,PHN2Zy8+',
  ])('rejects preview sources outside embedded JPEGs: %s', (dataUrl) => {
    expect(mediaPreviewSchema.safeParse({ frames: [{ ...frame, dataUrl }] }).success).toBe(false);
  });
  it('accepts one image or up to three timestamped video frames and rejects oversized or unbounded previews', () => {
    expect(mediaPreviewSchema.parse({ frames: [frame] }).frames).toHaveLength(1);
    expect(
      mediaPreviewSchema.parse({ frames: [0, 3, 10].map((atSeconds) => ({ ...frame, atSeconds })) })
        .frames,
    ).toHaveLength(3);
    expect(mediaPreviewSchema.safeParse({ frames: [frame, frame, frame, frame] }).success).toBe(
      false,
    );
    expect(
      mediaPreviewSchema.safeParse({
        frames: [{ ...frame, dataUrl: `data:image/jpeg;base64,${'A'.repeat(8_000_000)}` }],
      }).success,
    ).toBe(false);
    expect(mediaPreviewSchema.safeParse({ frames: [{ ...frame, atSeconds: -1 }] }).success).toBe(
      false,
    );
  });
  it('passes the authorized folder options and captured session and IDs to native commands', async () => {
    mock.invoke
      .mockResolvedValueOnce(scan)
      .mockResolvedValueOnce({ frames: [frame] })
      .mockResolvedValueOnce([entry]);
    await classificationService.scan({
      folderPath: 'F:\\Fotos',
      recursive: true,
      includeVideos: true,
    });
    await classificationService.preview('session', 'image-a');
    await classificationService.protect('session', ['image-a'], true);
    expect(mock.invoke).toHaveBeenNthCalledWith(1, 'scan_classification_review', {
      folderPath: 'F:\\Fotos',
      recursive: true,
      includeVideos: true,
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(2, 'preview_classified_media', {
      sessionId: 'session',
      itemId: 'image-a',
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(3, 'set_classification_protected', {
      sessionId: 'session',
      itemIds: ['image-a'],
      protected: true,
    });
  });
});
