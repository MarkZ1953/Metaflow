import { invoke } from '@tauri-apps/api/core';
import { planSchema, operationSchema } from '../../inbox/schemas/inbox-schema';
export interface MetadataRequest {
  paths: string[];
  recursive: boolean;
}
export const metadataService = {
  async preview(request: MetadataRequest) {
    return planSchema.parse(await invoke('preview_file_dates', { request }));
  },
  async execute(planId: string) {
    return operationSchema.parse(await invoke('execute_file_dates', { planId }));
  },
};
