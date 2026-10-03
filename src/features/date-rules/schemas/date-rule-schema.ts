import { z } from 'zod';
import { ruleSchema, type DateRule } from '../../inbox/schemas/inbox-schema';
import { messages as t } from '../../../shared/constants/messages';

export function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || year < 1000) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? stamp
    : null;
}
export const dateRuleFormSchema = ruleSchema
  .extend({
    name: z.string().trim().min(1, 'Escribe un nombre.').max(120),
    startDate: z.string().refine((v) => calendarDay(v) !== null, 'Elige una fecha válida.'),
    endDate: z.string().refine((v) => calendarDay(v) !== null, 'Elige una fecha válida.'),
    destinationPath: z.string().min(1, 'Selecciona una carpeta de destino.'),
  })
  .refine((r) => (calendarDay(r.startDate) ?? Infinity) <= (calendarDay(r.endDate) ?? -Infinity), {
    message: 'La fecha final debe ser igual o posterior al inicio.',
    path: ['endDate'],
  });
export function hasOverlap(rule: DateRule, other: DateRule[]): boolean {
  if (!rule.enabled) return false;
  const start = calendarDay(rule.startDate);
  const end = calendarDay(rule.endDate);
  if (start === null || end === null) return false;
  return other.some(
    (r) =>
      r.id !== rule.id &&
      r.enabled &&
      (calendarDay(r.startDate) ?? Infinity) <= end &&
      (calendarDay(r.endDate) ?? -Infinity) >= start,
  );
}
export const overlapMessage = t.overlap;
export const periodTemplates = [
  { name: 'Periodo 1', startDate: '2026-02-01', endDate: '2026-04-30' },
  { name: 'Periodo 2', startDate: '2026-05-01', endDate: '2026-07-31' },
  { name: 'Periodo 3', startDate: '2026-08-01', endDate: '2026-11-30' },
] as const;
