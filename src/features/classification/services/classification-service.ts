import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { operationSchema, stampSchema } from '../../inbox/schemas/inbox-schema';
import { authorizedFolderSchema } from '../../explorer/schemas/file-schema';

export const categorySchema = z.enum([
  'people',
  'animals',
  'screenshots',
  'memes',
  'documents',
  'landscapes',
  'objects',
  'other',
]);
export const mediaEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  stamp: stampSchema,
  kind: z.enum(['image', 'video']),
  labels: z
    .array(z.object({ category: categorySchema, score: z.number().finite().min(0).max(1) }))
    .max(8),
  protected: z.boolean(),
  uncertain: z.boolean(),
  status: z.enum(['classified', 'error']),
  error: z.string().nullable(),
  corrected: z.boolean().optional(),
  learned: z.boolean().optional(),
});
export const classificationSettingsSchema = z.object({
  sensitivity: z.enum(['conservative', 'balanced', 'broad']),
  analysisMode: z.enum(['fast', 'thorough']),
  readText: z.boolean(),
  useCorrections: z.boolean(),
});
export const classificationSettingsSnapshotSchema = z.object({
  settings: classificationSettingsSchema,
  correctionCount: z.number().int().nonnegative(),
  ocrAvailable: z.boolean().optional(),
  ocrLanguages: z.array(z.string()).optional(),
});
export type ClassificationSettings = z.infer<typeof classificationSettingsSchema>;
export type ClassificationSettingsSnapshot = z.infer<typeof classificationSettingsSnapshotSchema>;
export const defaultClassificationSettings: ClassificationSettings = {
  sensitivity: 'balanced',
  analysisMode: 'thorough',
  readText: true,
  useCorrections: true,
};
export const mediaScanSchema = z.object({
  sessionId: z.string().min(1),
  entries: z.array(mediaEntrySchema),
  unreadableCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  cancelled: z.boolean(),
  modelVersion: z.string(),
});
const jpegPrefix = 'data:image/jpeg;base64,';
export const mediaPreviewSchema = z.object({
  frames: z
    .array(
      z.object({
        dataUrl: z
          .string()
          .max(8_000_000)
          .refine((value) => {
            const data = value.slice(jpegPrefix.length);
            return (
              value.startsWith(jpegPrefix) &&
              data.length % 4 === 0 &&
              /^[A-Za-z0-9+/]+={0,2}$/.test(data)
            );
          }, 'Expected an embedded JPEG image'),
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
        atSeconds: z.number().finite().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(3),
});
export const mediaProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currentName: z.string(),
  phase: z.string().min(1),
});
export type MediaCategory = z.infer<typeof categorySchema>;
export type MediaEntry = z.infer<typeof mediaEntrySchema>;
export type MediaScan = z.infer<typeof mediaScanSchema>;
export type MediaPreview = z.infer<typeof mediaPreviewSchema>;
export type MediaProgress = z.infer<typeof mediaProgressSchema>;
export interface MediaScanOptions {
  folderPath: string | null;
  folderPaths?: string[] | null;
  recursive: boolean;
  includeVideos: boolean;
}
export const classificationService = {
  selectFolders: async () =>
    z
      .array(authorizedFolderSchema)
      .max(32)
      .parse(await invoke('select_classification_folders')),
  loadSettings: async () =>
    classificationSettingsSnapshotSchema.parse(await invoke('load_classification_settings')),
  saveSettings: async (settings: ClassificationSettings) =>
    classificationSettingsSnapshotSchema.parse(
      await invoke('save_classification_settings', { settings }),
    ),
  clearCorrections: async () =>
    z
      .object({
        configuration: classificationSettingsSnapshotSchema,
        entries: z.array(mediaEntrySchema),
      })
      .parse(await invoke('clear_classification_corrections')),
  categories: async (sessionId: string, itemIds: string[], categories: MediaCategory[] | null) =>
    z
      .array(mediaEntrySchema)
      .parse(await invoke('set_classification_categories', { sessionId, itemIds, categories })),
  scan: async (options: MediaScanOptions) =>
    mediaScanSchema.parse(await invoke('scan_classification_review', { ...options })),
  preview: async (sessionId: string, itemId: string) =>
    mediaPreviewSchema.parse(await invoke('preview_classified_media', { sessionId, itemId })),
  protect: async (sessionId: string, itemIds: string[], protectedValue: boolean) =>
    z.array(mediaEntrySchema).parse(
      await invoke('set_classification_protected', {
        sessionId,
        itemIds,
        protected: protectedValue,
      }),
    ),
  remove: async (sessionId: string, itemIds: string[]) =>
    operationSchema.parse(await invoke('remove_classified_files', { sessionId, itemIds })),
};
