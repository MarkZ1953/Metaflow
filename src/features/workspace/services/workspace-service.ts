import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import {
  planSchema,
  operationSchema,
  type ConflictPolicy,
  type IssueResolution,
} from '../../inbox/schemas/inbox-schema';
export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  roots: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
  favorites: z.array(z.string()),
});
export type Workspace = z.infer<typeof workspaceSchema>;
const folderPropertiesSchema = z.object({
  path: z.string(),
  name: z.string(),
  createdAt: z.number().nullable(),
  modifiedAt: z.number().nullable(),
  accessedAt: z.number().nullable(),
  readonly: z.boolean(),
});
export type FolderProperties = z.infer<typeof folderPropertiesSchema>;
export interface TransferRequest {
  sources: string[];
  destination: string;
  mode: 'move' | 'copy';
  policy: ConflictPolicy;
  presetId?: string | null;
  period?: string;
  duplicateAction?: string;
  resolutions?: Record<string, IssueResolution>;
  folderName?: string | null;
}
export const workspaceService = {
  properties: async (path: string) =>
    folderPropertiesSchema.parse(await invoke('get_folder_properties', { path })),
  load: async () => workspaceSchema.parse(await invoke('get_workspace')),
  add: async () => workspaceSchema.parse(await invoke('add_workspace_folder')),
  remove: async (id: string) =>
    workspaceSchema.parse(await invoke('remove_workspace_folder', { id })),
  favorite: async (path: string, enabled: boolean) =>
    workspaceSchema.parse(await invoke('set_workspace_favorite', { path, enabled })),
  newFolder: async (parent: string, name: string) =>
    z.string().parse(await invoke('create_workspace_folder', { parent, name })),
  openLocation: async (path: string) => {
    await invoke('open_file_location', { path });
  },
  preview: async (request: TransferRequest) =>
    planSchema.parse(await invoke('preview_transfer', { request })),
  execute: async (planId: string) =>
    operationSchema.parse(await invoke('execute_transfer', { planId })),
};
