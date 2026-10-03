import { describe, it, expect } from 'vitest';
import { workspaceSchema } from './workspace-service';
import { progressSchema, historyItemSchema } from '../../inbox/schemas/inbox-schema';
import { readFileDrag } from './workspace-drag';
describe('Workspace IPC contracts', () => {
  it('accepts independent drives and persistent favorite paths', () => {
    expect(
      workspaceSchema.parse({
        id: 'default',
        name: 'Workspace',
        roots: [
          { id: 'c', path: 'C:\\Downloads', name: 'Downloads' },
          { id: 'f', path: 'F:\\Universidad', name: 'Universidad' },
        ],
        favorites: ['F:\\Universidad\\Periodo 3'],
      }).roots,
    ).toHaveLength(2);
  });
  it('keeps v0.1 history readable and receives folder progress with bytes', () => {
    const legacy = {
      id: 'item',
      operationId: 'op',
      sourcePath: 'C:\\a.txt',
      destinationPath: 'F:\\a.txt',
      ruleName: 'Periodo 3',
      dateSource: 'modified',
      dateUsed: 1,
      stamp: { size: 4, modifiedAt: 1, createdAt: 1 },
      hash: 'digest',
      identity: 'id',
      status: 'completed',
      error: null,
    };
    expect(historyItemSchema.parse(legacy).kind).toBe('move');
    expect(
      progressSchema.parse({
        operationId: 'op',
        completed: 2,
        total: 3,
        phase: 'mkdir',
        completedBytes: 0,
        totalBytes: 5,
        currentName: 'folder',
      }).currentName,
    ).toBe('folder');
  });
  it('rejects malformed and excessive drag payloads', () => {
    const data = { getData: () => '{bad json' };
    expect(readFileDrag(data)).toEqual([]);
    expect(
      readFileDrag({
        getData: () => JSON.stringify(Array.from({ length: 10001 }, () => 'C:\\file.txt')),
      }),
    ).toEqual([]);
  });
});
