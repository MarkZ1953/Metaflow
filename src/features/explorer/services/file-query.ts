import { categoryNames } from '../../../shared/constants/categories';
import type { FileEntry, FileFilters, SortDirection, SortField } from '../types/explorer-types';

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function filterAndSortFiles(
  entries: FileEntry[],
  filters: FileFilters,
  field: SortField,
  direction: SortDirection,
): FileEntry[] {
  const query = normalize(filters.query.trim());
  const extension = filters.extension.replace(/^\./, '').trim().toLowerCase();
  return entries
    .filter((entry) => {
      if (!filters.showHidden && entry.hidden) return false;
      if (filters.category !== 'all' && entry.category !== filters.category) return false;
      if (query && !normalize(entry.name).includes(query)) return false;
      if (extension && entry.extension !== extension) return false;
      if (filters.minimumSize !== null && (entry.size === null || entry.size < filters.minimumSize))
        return false;
      return true;
    })
    .sort((a, b) => {
      // Folders stay first in either direction. Missing values stay last.
      if (a.kind === 'directory' && b.kind !== 'directory') return -1;
      if (a.kind !== 'directory' && b.kind === 'directory') return 1;
      const multiplier = direction === 'asc' ? 1 : -1;
      let difference: number;
      if (field === 'name') difference = collator.compare(a.name, b.name);
      else if (field === 'category')
        difference = collator.compare(categoryNames[a.category], categoryNames[b.category]);
      else {
        const aValue = a[field];
        const bValue = b[field];
        if (aValue === null && bValue !== null) return 1;
        if (bValue === null && aValue !== null) return -1;
        difference = (aValue ?? 0) - (bValue ?? 0);
      }
      return difference * multiplier || collator.compare(a.name, b.name);
    });
}
