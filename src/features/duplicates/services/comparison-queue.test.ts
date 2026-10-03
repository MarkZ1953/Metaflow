import { describe, expect, it } from 'vitest';
import {
  advanceComparison,
  nextUnvisited,
  removeComparisons,
  sameFilePath,
} from './comparison-queue';
import type { DuplicateComparison } from './duplicate-service';

const file = (path: string) => ({
  path,
  hash: null,
  planned: false,
  stamp: { size: 20, createdAt: 1, modifiedAt: 2 },
});
const pair = (id: string, left: string, right: string): DuplicateComparison => ({
  id,
  kind: 'similar',
  left: file(left),
  right: file(right),
});
describe('Duplicate comparison queue', () => {
  it('retains earlier comparisons for navigation and exposes a bounded finished cursor', () => {
    const queue = { comparisons: [pair('ab', 'a', 'b'), pair('ac', 'a', 'c')], index: 0 };
    expect(advanceComparison(queue, -1).index).toBe(0);
    const finished = advanceComparison(advanceComparison(queue, 1), 1);
    expect(finished.index).toBe(2);
    expect(advanceComparison(finished, 1).index).toBe(2);
    expect(advanceComparison(finished, -1).comparisons[1]?.id).toBe('ac');
  });
  it('removes every pair with a removed file while preserving other copies in a three-file group', () => {
    const queue = {
      comparisons: [pair('ab', 'a', 'b'), pair('ac', 'a', 'c'), pair('bc', 'b', 'c')],
      index: 1,
    };
    const remaining = removeComparisons(
      queue,
      (comparison) => comparison.left.path === 'a' || comparison.right.path === 'a',
    );
    expect(remaining.comparisons.map((comparison) => comparison.id)).toEqual(['bc']);
    expect(remaining.index).toBe(0);
  });
  it('continues with an unvisited pair after dismissal instead of returning to pairs already kept', () => {
    const queue = {
      comparisons: [
        pair('ab', 'a', 'b'),
        pair('ac', 'a', 'c'),
        pair('bc', 'b', 'c'),
        pair('de', 'd', 'e'),
      ],
      index: 1,
    };
    const remaining = removeComparisons(queue, (comparison) => comparison.id === 'ac');
    const next = nextUnvisited(remaining, new Set(['ab', 'bc']));
    expect(next.comparisons[next.index]?.id).toBe('de');
    expect(nextUnvisited(next, new Set(['ab', 'bc', 'de'])).index).toBe(3);
  });
  it('matches Windows paths case-insensitively across slash styles', () => {
    expect(sameFilePath('F:\\Fotos\\uno.JPG', 'f:/fotos/UNO.jpg')).toBe(true);
    expect(sameFilePath('F:\\Fotos\\uno.JPG', 'F:\\Fotos\\dos.JPG')).toBe(false);
  });
});
