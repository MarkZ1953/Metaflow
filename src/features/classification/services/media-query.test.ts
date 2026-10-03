import { describe, expect, it } from 'vitest';
import {
  emptyMediaFilters,
  filterMedia,
  nextMediaId,
  selectedMedia,
  visibleMedia,
} from './media-query';
import type { MediaEntry } from './classification-service';
const entry = (id: string, overrides: Partial<MediaEntry> = {}): MediaEntry => ({
  id,
  name: `${id}.jpg`,
  path: `F:\\Fotos\\${id}.jpg`,
  stamp: { size: 10, modifiedAt: null, createdAt: null },
  kind: 'image',
  labels: [
    { category: 'people', score: 0.7 },
    { category: 'memes', score: 0.5 },
  ],
  protected: false,
  uncertain: false,
  status: 'classified',
  error: null,
  ...overrides,
});
describe('Media gallery filtering and explicit selections', () => {
  it('can reveal excluded and kept files again while retaining the chosen media filters', () => {
    const entries = [
      entry('ordinary'),
      entry('kept', { protected: true }),
      entry('excluded'),
      entry('excluded-kept', { protected: true }),
    ];
    const visibility = {
      excluded: ['excluded', 'excluded-kept'],
      showExcluded: false,
      showProtected: false,
    };
    expect(visibleMedia(entries, emptyMediaFilters, visibility).map((item) => item.id)).toEqual([
      'ordinary',
    ]);
    expect(
      visibleMedia(entries, emptyMediaFilters, { ...visibility, showExcluded: true }).map(
        (item) => item.id,
      ),
    ).toEqual(['ordinary', 'excluded', 'excluded-kept']);
    expect(
      visibleMedia(entries, emptyMediaFilters, { ...visibility, showProtected: true }).map(
        (item) => item.id,
      ),
    ).toEqual(['ordinary', 'kept']);
    expect(
      visibleMedia(entries, { ...emptyMediaFilters, status: 'protected' }, visibility).map(
        (item) => item.id,
      ),
    ).toEqual(['kept']);
    expect(
      visibleMedia(
        entries,
        { ...emptyMediaFilters, status: 'excluded' },
        { ...visibility, showExcluded: true },
      ).map((item) => item.id),
    ).toEqual(['excluded', 'excluded-kept']);
    expect(
      visibleMedia(
        entries,
        { ...emptyMediaFilters, query: 'ordinary' },
        { ...visibility, showExcluded: true, showProtected: true },
      ).map((item) => item.id),
    ).toEqual(['ordinary']);
  });
  it('keeps overlapping person/meme images in both filters without deciding to discard them', () => {
    const entries = [entry('a'), entry('b', { labels: [{ category: 'animals', score: 0.9 }] })];
    expect(
      filterMedia(entries, { ...emptyMediaFilters, category: 'people' }).map((item) => item.id),
    ).toEqual(['a']);
    expect(
      filterMedia(entries, { ...emptyMediaFilters, category: 'memes' }).map((item) => item.id),
    ).toEqual(['a']);
    expect(selectedMedia(entries, [])).toEqual([]);
  });
  it('excludes protected entries and stale IDs from any removal selection', () => {
    const entries = [entry('a'), entry('b', { protected: true })];
    expect(selectedMedia(entries, ['a', 'b', 'missing'], true).map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(selectedMedia(entries, ['a', 'b']).map((item) => item.id)).toEqual(['a', 'b']);
  });
  it('combines video, uncertainty, path search and category filters', () => {
    const entries = [
      entry('Vídeo', {
        kind: 'video',
        uncertain: true,
        labels: [{ category: 'animals', score: 0.2 }],
      }),
      entry('a'),
    ];
    expect(
      filterMedia(entries, {
        category: 'animals',
        kind: 'video',
        status: 'uncertain',
        query: 'VÍDEO',
      }).map((item) => item.id),
    ).toEqual(['Vídeo']);
    expect(filterMedia(entries, { ...emptyMediaFilters, status: 'protected' })).toEqual([]);
  });
  it('advances a retired active file and keeps an unrelated active review stable', () => {
    const entries = [entry('a'), entry('b'), entry('c')];
    expect(nextMediaId(entries, 'b', new Set(['b']))).toBe('c');
    expect(nextMediaId(entries, 'c', new Set(['c']))).toBe('b');
    expect(nextMediaId(entries, 'b', new Set(['a']))).toBe('b');
    expect(nextMediaId(entries, 'b', new Set(['a', 'b', 'c']))).toBeNull();
  });
});
