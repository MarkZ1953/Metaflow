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
export type DuplicateScan = z.infer<typeof scanSchema>;
export const duplicateService = {
  scan: async () => scanSchema.parse(await invoke('scan_duplicates')),
  preview: async (keeper: string, members: string[], hash: string) =>
    planSchema.parse(await invoke('preview_duplicate_cleanup', { keeper, members, hash })),
  execute: async (planId: string) =>
    operationSchema.parse(await invoke('execute_duplicate_cleanup', { planId })),
};
