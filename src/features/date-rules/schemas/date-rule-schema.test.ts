import { describe, it, expect } from 'vitest';
import { calendarDay, dateRuleFormSchema, hasOverlap } from './date-rule-schema';
import type { DateRule } from '../../inbox/schemas/inbox-schema';
const rule: DateRule = {
  id: 'one',
  name: 'Periodo 1',
  startDate: '2026-02-01',
  endDate: '2026-04-30',
  destinationPath: 'D:\\Periodo 1',
  dateSource: 'modified',
  enabled: true,
};
describe('date rule form', () => {
  it('checks actual calendar days', () => {
    expect(calendarDay('2026-02-30')).toBeNull();
    expect(calendarDay('2028-02-29')).not.toBeNull();
    expect(calendarDay('2026-02-29')).toBeNull();
  });
  it('requires destination and ordered dates', () => {
    expect(dateRuleFormSchema.safeParse({ ...rule, destinationPath: '' }).success).toBe(false);
    expect(dateRuleFormSchema.safeParse({ ...rule, endDate: '2026-01-01' }).success).toBe(false);
    expect(dateRuleFormSchema.safeParse(rule).success).toBe(true);
  });
  it('rejects shared endpoint but allows adjacent periods', () => {
    expect(
      hasOverlap({ ...rule, id: 'two', startDate: '2026-04-30', endDate: '2026-05-31' }, [rule]),
    ).toBe(true);
    expect(
      hasOverlap({ ...rule, id: 'two', startDate: '2026-05-01', endDate: '2026-07-31' }, [rule]),
    ).toBe(false);
  });
  it('ignores the edited rule and disabled ranges', () => {
    expect(hasOverlap(rule, [rule])).toBe(false);
    expect(hasOverlap({ ...rule, id: 'two', enabled: false }, [rule])).toBe(false);
  });
});
