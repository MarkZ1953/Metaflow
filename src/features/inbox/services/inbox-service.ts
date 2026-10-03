import { invoke, isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';
import {
  snapshotSchema,
  planSchema,
  operationSchema,
  type InboxSnapshot,
  type DateRule,
  type OrganizationPlan,
  type Operation,
  type ConflictPolicy,
  type IssueResolution,
} from '../schemas/inbox-schema';

export const isDesktop = isTauri();
export interface WorkflowService {
  snapshot(): Promise<InboxSnapshot>;
  chooseInbox(): Promise<InboxSnapshot>;
  saveRules(rules: DateRule[]): Promise<InboxSnapshot>;
  chooseDestination(): Promise<string | null>;
  retry(): Promise<InboxSnapshot>;
  preview(
    policy: ConflictPolicy,
    duplicateAction?: string,
    resolutions?: Record<string, IssueResolution>,
  ): Promise<OrganizationPlan>;
  execute(id: string): Promise<Operation>;
  history(): Promise<Operation[]>;
  undo(id: string): Promise<Operation>;
  cancel(): Promise<void>;
}
const folderSchema = z.object({ path: z.string(), name: z.string() });
export const desktopWorkflow: WorkflowService = {
  snapshot: async () => snapshotSchema.parse(await invoke('get_inbox')),
  chooseInbox: async () => snapshotSchema.parse(await invoke('choose_inbox')),
  saveRules: async (rules) => snapshotSchema.parse(await invoke('save_date_rules', { rules })),
  chooseDestination: async () => {
    const value = await invoke('select_folder');
    return value === null ? null : folderSchema.parse(value).path;
  },
  retry: async () => snapshotSchema.parse(await invoke('retry_inbox')),
  preview: async (policy, duplicateAction = 'skip', resolutions = {}) =>
    planSchema.parse(
      await invoke('preview_organization', { policy, duplicateAction, resolutions }),
    ),
  execute: async (id) =>
    operationSchema.parse(await invoke('execute_organization', { planId: id })),
  history: async () => z.array(operationSchema).parse(await invoke('get_history')),
  undo: async (id) => operationSchema.parse(await invoke('undo_operation', { operationId: id })),
  cancel: async () => {
    await invoke('cancel_operation');
  },
};
