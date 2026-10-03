import { z } from 'zod';
export const dateSourceSchema = z.enum(['created', 'modified', 'accessed']);
export const stampSchema = z.object({
  size: z.number().int().nonnegative(),
  modifiedAt: z.number().nullable(),
  createdAt: z.number().nullable(),
});
export const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  destinationPath: z.string(),
  dateSource: dateSourceSchema,
  enabled: z.boolean(),
});
export const inboxFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  extension: z.string(),
  stamp: stampSchema,
  accessedAt: z.number().nullable(),
  status: z.string(),
  ruleId: z.string().nullable(),
  ruleName: z.string().nullable(),
  destinationPath: z.string().nullable(),
  dateSource: dateSourceSchema.nullable(),
  dateUsed: z.number().nullable(),
  error: z.string().nullable(),
});
export const snapshotSchema = z.object({
  inbox: z.object({ id: z.string(), path: z.string(), mode: z.literal('manual') }).nullable(),
  rules: z.array(ruleSchema),
  files: z.array(inboxFileSchema),
  watcherStatus: z.string(),
  error: z.string().nullable(),
});
export const planItemSchema = z.object({
  dateChange: z
    .object({
      createdTicks: z.string(),
      modifiedBeforeTicks: z.string(),
      modifiedAfterTicks: z.string(),
    })
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
  sourcePath: z.string(),
  destinationPath: z.string(),
  ruleName: z.string(),
  dateSource: dateSourceSchema,
  dateUsed: z.number(),
  stamp: stampSchema,
  conflict: z.boolean(),
  action: z.enum(['move', 'copy', 'skip', 'mkdir', 'rmdir', 'dates']),
  entryKind: z.enum(['file', 'directory']).optional(),
  hash: z.string().optional(),
  duplicates: z
    .array(
      z.object({
        path: z.string(),
        stamp: stampSchema,
        hash: z.string().nullable(),
        planned: z.boolean(),
      }),
    )
    .optional(),
  existing: z
    .object({
      path: z.string(),
      stamp: stampSchema,
      hash: z.string().nullable(),
      planned: z.boolean(),
    })
    .nullable()
    .optional(),
  backup: z.boolean().optional(),
});
export const planSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  items: z.array(planItemSchema),
  unmatchedCount: z.number(),
  unreadableCount: z.number().optional(),
});
export const historyItemSchema = planItemSchema.omit({ action: true, conflict: true }).extend({
  id: z.string(),
  operationId: z.string(),
  hash: z.string(),
  identity: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  kind: z.string().default('move'),
  undoPath: z.string().nullable().default(null),
});
export const operationSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  status: z.string(),
  items: z.array(historyItemSchema),
});
export const progressSchema = z.object({
  operationId: z.string(),
  completed: z.number(),
  total: z.number(),
  phase: z.enum(['move', 'copy', 'skip', 'undo', 'mkdir', 'rmdir', 'dates']),
  completedBytes: z.number().optional(),
  totalBytes: z.number().optional(),
  currentName: z.string().optional(),
});
export type InboxFile = z.infer<typeof inboxFileSchema>;
export type DateRule = z.infer<typeof ruleSchema>;
export type InboxSnapshot = z.infer<typeof snapshotSchema>;
export type OrganizationPlan = z.infer<typeof planSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type HistoryItem = z.infer<typeof historyItemSchema>;
export type BatchProgress = z.infer<typeof progressSchema>;
export type ConflictPolicy = 'skip' | 'keep-both' | 'replace';
export type IssueResolution = { conflictPolicy?: ConflictPolicy; duplicateAction?: string };
