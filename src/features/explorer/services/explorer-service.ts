import { invoke, isTauri } from '@tauri-apps/api/core';
import { authorizedFolderSchema, directoryListingSchema } from '../schemas/file-schema';
import type { AuthorizedFolder, DirectoryListing } from '../types/explorer-types';

export interface ExplorerService {
  pickFolder(): Promise<AuthorizedFolder | null>;
  readDirectory(path: string): Promise<DirectoryListing>;
  forgetFolder(path: string): Promise<void>;
}

export const isDesktop = isTauri();

export const nativeExplorerService: ExplorerService = {
  async pickFolder() {
    if (!isDesktop) throw { code: 'DESKTOP_REQUIRED' };
    const response: unknown = await invoke('select_folder');
    return response === null ? null : authorizedFolderSchema.parse(response);
  },
  async readDirectory(path) {
    if (!isDesktop) throw { code: 'DESKTOP_REQUIRED' };
    const response: unknown = await invoke('read_directory', { path });
    return directoryListingSchema.parse(response);
  },
  async forgetFolder(path) {
    if (!isDesktop) throw { code: 'DESKTOP_REQUIRED' };
    await invoke('forget_folder', { path });
  },
};
