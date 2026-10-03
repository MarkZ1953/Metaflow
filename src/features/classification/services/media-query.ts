import type { MediaCategory, MediaEntry } from './classification-service';
export interface MediaFilters {
  category: MediaCategory | 'all';
  kind: 'all' | 'image' | 'video';
  status: 'all' | 'available' | 'protected' | 'excluded' | 'uncertain' | 'error';
  query: string;
}
export const emptyMediaFilters: MediaFilters = {
  category: 'all',
  kind: 'all',
  status: 'all',
  query: '',
};
export function filterMedia(
  entries: MediaEntry[],
  filters: MediaFilters,
  excludedIds: string[] = [],
): MediaEntry[] {
  const query = filters.query.trim().toLocaleLowerCase('es');
  const excluded = new Set(excludedIds);
  return entries.filter(
    (entry) =>
      (filters.category === 'all' ||
        entry.labels.some((label) => label.category === filters.category)) &&
      (filters.kind === 'all' || entry.kind === filters.kind) &&
      (filters.status === 'all' ||
        (filters.status === 'available' && !entry.protected) ||
        (filters.status === 'protected' && entry.protected) ||
        (filters.status === 'excluded' && excluded.has(entry.id)) ||
        (filters.status === 'uncertain' && entry.uncertain) ||
        (filters.status === 'error' && entry.status === 'error')) &&
      (!query ||
        entry.path.toLocaleLowerCase('es').includes(query) ||
        entry.name.toLocaleLowerCase('es').includes(query)),
  );
}
export interface MediaVisibility {
  excluded: string[];
  showExcluded: boolean;
  showProtected: boolean;
}
export function visibleMedia(
  entries: MediaEntry[],
  filters: MediaFilters,
  visibility: MediaVisibility,
): MediaEntry[] {
  const excluded = new Set(visibility.excluded);
  return filterMedia(entries, filters, visibility.excluded).filter((entry) => {
    if (excluded.has(entry.id)) return visibility.showExcluded;
    return !entry.protected || visibility.showProtected || filters.status === 'protected';
  });
}
export function selectedMedia(
  entries: MediaEntry[],
  selected: string[],
  removableOnly = false,
): MediaEntry[] {
  const ids = new Set(selected);
  return entries.filter((entry) => ids.has(entry.id) && (!removableOnly || !entry.protected));
}
export function sameMediaPath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase();
}
export function nextMediaId(
  entries: MediaEntry[],
  currentId: string | null,
  removed: Set<string>,
): string | null {
  const current = entries.findIndex((entry) => entry.id === currentId);
  if (current < 0) return null;
  if (!removed.has(entries[current]!.id)) return currentId;
  return (
    entries.slice(current + 1).find((entry) => !removed.has(entry.id))?.id ??
    [...entries.slice(0, current)].reverse().find((entry) => !removed.has(entry.id))?.id ??
    null
  );
}
