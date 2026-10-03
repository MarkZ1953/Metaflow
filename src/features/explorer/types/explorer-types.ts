import type { z } from 'zod';
import type {
  authorizedFolderSchema,
  categorySchema,
  directoryListingSchema,
  fileEntrySchema,
} from '../schemas/file-schema';

export type FileEntry = z.infer<typeof fileEntrySchema>;
export type Category = z.infer<typeof categorySchema>;
export type AuthorizedFolder = z.infer<typeof authorizedFolderSchema>;
export type DirectoryListing = z.infer<typeof directoryListingSchema>;
export type CategoryFilter = Category | 'all';
export type SortField = 'name' | 'size' | 'category' | 'modifiedAt';
export type SortDirection = 'asc' | 'desc';
export interface FileFilters {
  category: CategoryFilter;
  query: string;
  extension: string;
  showHidden: boolean;
  minimumSize: number | null;
}
