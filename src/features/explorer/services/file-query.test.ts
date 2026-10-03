import { describe, expect, it } from 'vitest';
import { filterAndSortFiles } from './file-query';
import { demoService } from './demo-service';
import type { FileFilters } from '../types/explorer-types';

const defaults: FileFilters = {
  category: 'all',
  query: '',
  extension: '',
  showHidden: false,
  minimumSize: null,
};
const folder = await demoService.pickFolder();
const files = (await demoService.readDirectory(folder!.path)).entries;

describe('folder-local queries', () => {
  it('keeps folders first in either sort direction and does not mutate the listing', () => {
    const original = [...files];
    for (const direction of ['asc', 'desc'] as const) {
      const result = filterAndSortFiles(files, defaults, 'name', direction);
      expect(result[0]?.kind).toBe('directory');
      expect(result[1]?.kind).toBe('directory');
    }
    expect(files).toEqual(original);
  });
  it('ignores accents and case in search', () => {
    expect(
      filterAndSortFiles(files, { ...defaults, query: 'PRESENTACION' }, 'name', 'asc').map(
        (entry) => entry.name,
      ),
    ).toEqual(['Presentación de marca.pdf']);
  });
  it('combines category, extension, query and size filters', () => {
    const result = filterAndSortFiles(
      files,
      {
        ...defaults,
        category: 'document',
        extension: '.PDF',
        query: 'marca',
        minimumSize: 1024 ** 2,
      },
      'name',
      'asc',
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.extension).toBe('pdf');
  });
  it('does not include directories in a size filter', () => {
    expect(
      filterAndSortFiles(files, { ...defaults, minimumSize: 0 }, 'size', 'asc').every(
        (file) => file.kind !== 'directory',
      ),
    ).toBe(true);
  });
  it('sorts bytes numerically instead of formatted sizes', () => {
    const result = filterAndSortFiles(files, { ...defaults, minimumSize: 0 }, 'size', 'desc');
    expect(result[0]?.name).toBe('Recorrido por el estudio.mp4');
    expect(result.at(-1)?.name).toBe('design-tokens.json');
  });
  it('hides hidden files by default and allows revealing them', () => {
    expect(filterAndSortFiles(files, defaults, 'name', 'asc').some((file) => file.hidden)).toBe(
      false,
    );
    expect(
      filterAndSortFiles(files, { ...defaults, showHidden: true }, 'name', 'asc').some(
        (file) => file.hidden,
      ),
    ).toBe(true);
  });
  it('uses natural sorting for numbered file names', () => {
    const sample = files.find((file) => file.kind === 'file')!;
    const entries = ['10.pdf', '2.pdf', '1.pdf'].map((name) => ({ ...sample, name }));
    expect(filterAndSortFiles(entries, defaults, 'name', 'asc').map((entry) => entry.name)).toEqual(
      ['1.pdf', '2.pdf', '10.pdf'],
    );
  });
  it('keeps unavailable dates last', () => {
    const sample = files.find((file) => file.kind === 'file')!;
    const entries = [
      { ...sample, name: 'unknown', modifiedAt: null },
      { ...sample, name: 'known' },
    ];
    expect(filterAndSortFiles(entries, defaults, 'modifiedAt', 'desc').at(-1)?.name).toBe(
      'unknown',
    );
  });
});
