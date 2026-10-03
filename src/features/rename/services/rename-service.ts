import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
export const presetSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(120),
  format: z.string().min(1).max(240),
  letterCase: z.enum(['unchanged', 'lower', 'upper', 'title']),
  spaceReplacement: z.enum(['unchanged', 'dash', 'underscore']),
  collapseSpaces: z.boolean(),
  removeAccents: z.boolean(),
});
export const configurationSchema = z.object({
  presets: z.array(presetSchema),
  inboxPresetId: z.string().nullable(),
  rulePresets: z.record(z.string(), z.string()),
});
export type RenamePreset = z.infer<typeof presetSchema>;
export type RenameConfiguration = z.infer<typeof configurationSchema>;
export const renameService = {
  load: async () => configurationSchema.parse(await invoke('get_rename_configuration')),
  save: async (configuration: RenameConfiguration) =>
    configurationSchema.parse(await invoke('save_rename_configuration', { configuration })),
  sample: async (preset: RenamePreset, original: string, period: string, date: number) =>
    z.string().parse(await invoke('preview_filename', { preset, original, period, date })),
};
export const templates: Omit<RenamePreset, 'id'>[] = [
  {
    name: 'Universidad',
    format: '{period}_{date:yyyy-MM-dd}_{name}',
    letterCase: 'lower',
    spaceReplacement: 'dash',
    collapseSpaces: true,
    removeAccents: true,
  },
  {
    name: 'Fotos',
    format: '{date:yyyyMMdd}_{counter:0001}',
    letterCase: 'unchanged',
    spaceReplacement: 'unchanged',
    collapseSpaces: true,
    removeAccents: false,
  },
  {
    name: 'Documentos',
    format: '{year}-{month}_{name}',
    letterCase: 'unchanged',
    spaceReplacement: 'unchanged',
    collapseSpaces: true,
    removeAccents: false,
  },
];
