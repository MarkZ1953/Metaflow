import { describe, expect, it } from 'vitest';
import { historyItemSchema, planSchema, progressSchema } from '../../inbox/schemas/inbox-schema';

const item = {
  sourcePath: 'F:\\Fotos\\foto.jpg',
  destinationPath: 'F:\\Fotos\\foto.jpg',
  ruleName: 'Modificación = creación',
  dateSource: 'created',
  dateUsed: 1770394428000,
  stamp: { size: 10, createdAt: 1770394428000, modifiedAt: 1790021215000 },
  dateChange: {
    createdTicks: '134148680280000017',
    modifiedBeforeTicks: '134344948150000042',
    modifiedAfterTicks: '134148680280000017',
  },
};
describe('Date correction IPC', () => {
  it('preserves 100ns ticks above JavaScript integer precision in preview and durable history', () => {
    const preview = planSchema.parse({
      id: 'plan',
      createdAt: 1,
      unmatchedCount: 0,
      items: [{ ...item, action: 'dates', conflict: false }],
    });
    const history = historyItemSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...item,
          id: 'item',
          operationId: 'op',
          hash: '',
          identity: 'file-id',
          status: 'completed',
          error: null,
          kind: 'dates',
        }),
      ),
    );
    expect(history.dateChange).toEqual(preview.items[0]?.dateChange);
    expect(history.dateChange?.createdTicks).toBe('134148680280000017');
    expect(
      progressSchema.parse({
        operationId: 'op',
        completed: 1,
        total: 1,
        phase: 'dates',
        totalBytes: 0,
      }).phase,
    ).toBe('dates');
  });
  it('rejects numeric ticks that could silently lose precision', () => {
    expect(
      planSchema.safeParse({
        id: 'plan',
        createdAt: 1,
        unmatchedCount: 0,
        items: [
          {
            ...item,
            action: 'dates',
            conflict: false,
            dateChange: { ...item.dateChange, createdTicks: Number(item.dateChange.createdTicks) },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
