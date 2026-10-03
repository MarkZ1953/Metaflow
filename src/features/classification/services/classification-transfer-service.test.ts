import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import type { HistoryItem, Operation } from '../../inbox/schemas/inbox-schema';
import type { MediaEntry } from './classification-service';
import { emptyMediaFilters } from './media-query';
import {
  classificationTransferService,
  completedClassifiedTransferIds,
  reconcileClassifiedTransfer,
} from './classification-transfer-service';

function entry(id: string, protectedValue = false): MediaEntry {
  return {
    id,
    path: `F:\\Fotos\\${id}.jpg`,
    name: `${id}.jpg`,
    stamp: { size: 20, modifiedAt: 1, createdAt: null },
    kind: 'image',
    labels: [{ category: 'people', score: 0.8 }],
    protected: protectedValue,
    uncertain: false,
    status: 'classified',
    error: null,
  };
}
function historyItem(id: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id,
    operationId: 'transfer',
    sourcePath: `f:/fotos/${id}.jpg`,
    destinationPath: `F:\\Conservar\\${id}.jpg`,
    stamp: { size: 20, modifiedAt: 1, createdAt: null },
    ruleName: 'Transferencia',
    dateSource: 'modified',
    dateUsed: 1,
    hash: 'content',
    identity: 'identity',
    status: 'completed',
    kind: 'move',
    undoPath: null,
    error: null,
    ...overrides,
  };
}
function operation(items: HistoryItem[]): Operation {
  return { id: 'transfer', createdAt: 1, status: 'completed', items };
}
function gallery(entries: MediaEntry[]) {
  return {
    entries,
    selected: entries.map((item) => item.id),
    excluded: ['a'],
    activeId: 'a',
    filters: { ...emptyMediaFilters },
    showExcluded: true,
    showProtected: true,
    lastOperationId: 'previous-removal',
  };
}

describe('Classification transfer IPC', () => {
  beforeEach(() => mock.invoke.mockReset());
  it('binds selected IDs, exact source paths and preview execution to the analysis session', async () => {
    const request = {
      sources: [entry('a').path],
      destination: 'F:\\Conservar',
      mode: 'move' as const,
      policy: 'keep-both' as const,
      duplicateAction: 'keep-both',
    };
    const plan = { id: 'plan', createdAt: 1, items: [], unmatchedCount: 0 };
    const result = { operation: operation([historyItem('a')]), entries: [] };
    mock.invoke.mockResolvedValueOnce(plan).mockResolvedValueOnce(result);
    expect(await classificationTransferService.preview('session', ['a'], request)).toEqual(plan);
    expect(await classificationTransferService.execute('session', 'plan')).toEqual(result);
    expect(mock.invoke).toHaveBeenNthCalledWith(1, 'preview_classified_transfer', {
      sessionId: 'session',
      itemIds: ['a'],
      request,
    });
    expect(mock.invoke).toHaveBeenNthCalledWith(2, 'execute_classified_transfer', {
      sessionId: 'session',
      planId: 'plan',
    });
  });
  it('rejects an invalid native result before it can replace gallery state', async () => {
    mock.invoke.mockResolvedValueOnce({
      operation: operation([]),
      entries: [{ ...entry('a'), kind: 'folder' }],
    });
    await expect(classificationTransferService.execute('session', 'plan')).rejects.toThrow();
  });
});

describe('Transfer gallery reconciliation', () => {
  it('removes only successful source moves and keeps skipped or failed selections available', () => {
    const entries = [entry('a', true), entry('b'), entry('c')];
    const result = {
      operation: operation([
        historyItem('a'),
        historyItem('b', { status: 'failed', error: 'locked' }),
        historyItem('c', { status: 'skipped', kind: 'skip' }),
      ]),
      entries: [entries[1]!, entries[2]!],
    };
    const patch = reconcileClassifiedTransfer(gallery(entries), result);
    expect(patch.entries.map((item) => item.id)).toEqual(['b', 'c']);
    expect(patch.selected).toEqual(['b', 'c']);
    expect(patch.excluded).toEqual([]);
    expect(patch.activeId).toBe('b');
    expect(patch.lastOperationId).toBe('transfer');
    expect([...completedClassifiedTransferIds(entries, result)]).toEqual(['a']);
  });
  it('retains copied originals, their protection, exclusion and selection for further folder batches', () => {
    const entries = [entry('a', true), entry('b')];
    const result = { operation: operation([historyItem('a', { kind: 'copy' })]), entries };
    const patch = reconcileClassifiedTransfer(gallery(entries), result);
    expect(patch.entries).toEqual(entries);
    expect(patch.selected).toEqual(['a', 'b']);
    expect(patch.excluded).toEqual(['a']);
    expect(patch.activeId).toBe('a');
    expect(patch.lastOperationId).toBe('transfer');
  });
  it('does not mistake a destination backup or a same-path no-op for a completed original transfer', () => {
    const entries = [entry('a'), entry('b')];
    const result = {
      operation: operation([
        historyItem('a', { backup: true }),
        historyItem('b', { destinationPath: entry('b').path }),
      ]),
      entries,
    };
    const patch = reconcileClassifiedTransfer(gallery(entries), result);
    expect(patch.entries).toEqual(entries);
    expect(patch.selected).toEqual(['a', 'b']);
    expect(patch.lastOperationId).toBe('transfer');
    expect(completedClassifiedTransferIds(entries, result).size).toBe(0);
  });
  it('removes a backed-up destination shown in the gallery even when its selected incoming source fails, and exposes Undo', () => {
    const entries = [entry('a'), entry('b')];
    const result = {
      operation: operation([
        historyItem('a', { backup: true, destinationPath: 'F:\\Fotos\\.metaflow-recovery\\a.jpg' }),
        historyItem('b', { status: 'failed', error: 'locked' }),
      ]),
      entries: [entries[1]!],
    };
    const patch = reconcileClassifiedTransfer(gallery(entries), result);
    expect(patch.entries.map((item) => item.id)).toEqual(['b']);
    expect(patch.selected).toEqual(['b']);
    expect(patch.excluded).toEqual([]);
    expect(patch.activeId).toBe('b');
    expect(patch.lastOperationId).toBe('transfer');
    expect(completedClassifiedTransferIds([entries[1]!], result).size).toBe(0);
  });
  it('advances review across currently visible items while leaving hidden kept files hidden', () => {
    const entries = [entry('a'), entry('b', true), entry('c')];
    const result = { operation: operation([historyItem('a')]), entries: entries.slice(1) };
    const patch = reconcileClassifiedTransfer(
      { ...gallery(entries), excluded: [], showProtected: false },
      result,
    );
    expect(patch.activeId).toBe('c');
    expect(patch.entries.map((item) => item.id)).toEqual(['b', 'c']);
  });
});
