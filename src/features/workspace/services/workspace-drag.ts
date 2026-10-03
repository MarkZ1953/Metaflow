import { z } from 'zod';
const mime = 'application/x-metaflow-paths';
const pathsSchema = z.array(z.string().min(1)).min(1).max(10000);
export function startFileDrag(data: DataTransfer, paths: string[]) {
  data.effectAllowed = 'copyMove';
  data.setData(mime, JSON.stringify(paths));
}
export function isFileDrag(data: DataTransfer) {
  return data.types.includes(mime);
}
export function readFileDrag(data: Pick<DataTransfer, 'getData'>): string[] {
  try {
    const result = pathsSchema.safeParse(JSON.parse(data.getData(mime)));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
