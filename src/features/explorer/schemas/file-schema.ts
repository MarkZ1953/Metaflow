import { z } from 'zod';

export const categorySchema = z.enum([
  'folder',
  'image',
  'video',
  'audio',
  'document',
  'spreadsheet',
  'presentation',
  'archive',
  'code',
  'executable',
  'other',
]);

const timestampSchema = z.number().int().nonnegative().max(8_640_000_000_000_000).nullable();

export const fileEntrySchema = z.object({
  path: z.string().min(1),
  relativePath: z.string().min(1),
  name: z.string().min(1),
  extension: z.string(),
  kind: z.enum(['file', 'directory', 'symlink']),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  mimeType: z.string().nullable(),
  typeSource: z.enum(['content', 'extension', 'unknown']),
  category: categorySchema,
  createdAt: timestampSchema,
  modifiedAt: timestampSchema,
  accessedAt: timestampSchema,
  hidden: z.boolean(),
  readonly: z.boolean(),
});

export const authorizedFolderSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});
export const directoryListingSchema = z.object({
  path: z.string().min(1),
  rootPath: z.string().min(1),
  parentPath: z.string().min(1).nullable(),
  entries: z.array(fileEntrySchema),
  unreadableCount: z.number().int().nonnegative(),
  scannedAt: z.number().int().nonnegative(),
});
