import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { stampSchema, planSchema, operationSchema } from '../../inbox/schemas/inbox-schema';
const comparisonSchema = z.object({
  path: z.string(),
  stamp: stampSchema,
  hash: z.string().nullable(),
  planned: z.boolean(),
});
const scanSchema = z.object({
  groups: z.array(z.object({ hash: z.string(), files: z.array(comparisonSchema) })),
  unreadableCount: z.number(),
});
export const duplicateReviewSchema = z.object({
  sessionId: z.string().min(1),
  comparisons: z.array(
    z.object({
      id: z.string().min(1),
      left: comparisonSchema,
      right: comparisonSchema,
      kind: z.enum(['exact', 'similar']),
    }),
  ),
  unreadableCount: z.number().int().nonnegative(),
  ignoredCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const jpegPrefix = 'data:image/jpeg;base64,';
export const duplicateImageSchema = z.object({
  dataUrl: z
    .string()
    .max(8_000_000)
    .refine(
      (value) =>
        value.startsWith(jpegPrefix) &&
        value.slice(jpegPrefix.length).length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(jpegPrefix.length)),
      'Expected an embedded JPEG image',
    ),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});
export type DuplicateScan = z.infer<typeof scanSchema>;
export type DuplicateReview = z.infer<typeof duplicateReviewSchema>;
export type DuplicateComparison = DuplicateReview['comparisons'][number];
export type DuplicateFile = DuplicateComparison['left'];
export type DuplicateImage = z.infer<typeof duplicateImageSchema>;
export type ComparisonSide = 'left' | 'right';
export const duplicateService = {
  scan: async () => scanSchema.parse(await invoke('scan_duplicates')),
  preview: async (keeper: string, members: string[], hash: string) =>
    planSchema.parse(await invoke('preview_duplicate_cleanup', { keeper, members, hash })),
  execute: async (planId: string) =>
    operationSchema.parse(await invoke('execute_duplicate_cleanup', { planId })),
  scanReview: async (includeSimilar: boolean) =>
    duplicateReviewSchema.parse(await invoke('scan_duplicate_review', { includeSimilar })),
  image: async (sessionId: string, comparisonId: string, side: ComparisonSide) =>
    duplicateImageSchema.parse(
      await invoke('preview_duplicate_image', { sessionId, comparisonId, side }),
    ),
  dismiss: async (sessionId: string, comparisonId: string) => {
    await invoke('dismiss_duplicate_comparison', { sessionId, comparisonId });
  },
  resetDismissals: async () => {
    await invoke('reset_duplicate_dismissals');
  },
  remove: async (sessionId: string, comparisonId: string, side: ComparisonSide) =>
    operationSchema.parse(await invoke('remove_duplicate_file', { sessionId, comparisonId, side })),
};
