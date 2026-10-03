import type { DuplicateComparison } from './duplicate-service';

export interface ComparisonQueue {
  comparisons: DuplicateComparison[];
  index: number;
}
export function advanceComparison(queue: ComparisonQueue, direction: 1 | -1): ComparisonQueue {
  return {
    comparisons: queue.comparisons,
    index: Math.max(0, Math.min(queue.comparisons.length, queue.index + direction)),
  };
}
export function removeComparisons(
  queue: ComparisonQueue,
  remove: (comparison: DuplicateComparison) => boolean,
): ComparisonQueue {
  const comparisons = queue.comparisons.filter((comparison) => !remove(comparison));
  const removedBefore = queue.comparisons.slice(0, queue.index).filter(remove).length;
  return { comparisons, index: Math.min(comparisons.length, queue.index - removedBefore) };
}
export function sameFilePath(left: string, right: string): boolean {
  return (
    left.replaceAll('/', '\\').toLocaleLowerCase('en-US') ===
    right.replaceAll('/', '\\').toLocaleLowerCase('en-US')
  );
}
export function nextUnvisited(
  queue: ComparisonQueue,
  visited: ReadonlySet<string>,
): ComparisonQueue {
  const next = queue.comparisons.findIndex(
    (comparison, index) => index >= queue.index && !visited.has(comparison.id),
  );
  if (next >= 0) return { comparisons: queue.comparisons, index: next };
  const earlier = queue.comparisons.findIndex((comparison) => !visited.has(comparison.id));
  return {
    comparisons: queue.comparisons,
    index: earlier >= 0 ? earlier : queue.comparisons.length,
  };
}
