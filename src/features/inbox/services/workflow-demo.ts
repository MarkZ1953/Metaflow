import type { WorkflowService } from './inbox-service';
import type { DateRule, InboxFile, InboxSnapshot, OrganizationPlan } from '../schemas/inbox-schema';
import { periodTemplates } from '../../date-rules/schemas/date-rule-schema';

export function createWorkflowDemo(): WorkflowService {
  let rules: DateRule[] = periodTemplates.map((r, i) => ({
    ...r,
    id: `period-${i}`,
    destinationPath: `D:\\Universidad\\${r.name}`,
    dateSource: 'modified',
    enabled: true,
  }));
  const names = [
    'tarea-1.pdf',
    'apuntes-calculo.pdf',
    'proyecto-final.docx',
    'lectura-semana-08.pdf',
    'laboratorio-03.xlsx',
    'presentacion-equipo.pptx',
    'resumen-parcial.pdf',
    'bibliografia.pdf',
    'notas-clase.md',
    'archivo-sin-fecha.txt',
    'video-copiando.mp4',
    'descarga.pdf.crdownload',
  ];
  const files: InboxFile[] = names.map((name, i) => {
    const rule = i < 4 ? rules[2] : i < 7 ? rules[1] : rules[0];
    const modified = new Date(
      i < 4 ? '2026-09-21T14:06:55' : i < 7 ? '2026-06-15T09:30:00' : '2026-03-10T17:00:00',
    ).getTime();
    const matched = i < 9;
    return {
      path: `D:\\Metaflow\\Inbox\\${name}`,
      name,
      extension: name.split('.').at(-1) ?? '',
      stamp: {
        size: 124000 + i * 325981,
        createdAt: new Date('2026-02-06T19:13:48').getTime(),
        modifiedAt: i === 9 ? new Date('2025-12-20T12:00:00').getTime() : modified,
      },
      accessedAt: new Date('2026-10-02T14:52:16').getTime(),
      status: matched ? 'matched' : i === 9 ? 'needs-review' : 'waiting-for-stability',
      ruleId: matched ? (rule?.id ?? null) : null,
      ruleName: matched ? (rule?.name ?? null) : null,
      destinationPath: matched ? `${rule?.destinationPath}\\${name}` : null,
      dateSource: matched ? 'modified' : null,
      dateUsed: matched ? modified : null,
      error: null,
    };
  });
  const snapshot = (): InboxSnapshot => ({
    inbox: { id: 'demo-inbox', path: 'D:\\Metaflow\\Inbox', mode: 'manual' },
    rules,
    files,
    watcherStatus: 'watching',
    error: null,
  });
  return {
    snapshot: async () => snapshot(),
    chooseInbox: async () => snapshot(),
    saveRules: async (next) => {
      rules = next;
      return snapshot();
    },
    chooseDestination: async () => 'D:\\Universidad\\Nuevo periodo',
    retry: async () => snapshot(),
    preview: async (policy) =>
      ({
        id: 'demo-plan',
        createdAt: Date.now(),
        unmatchedCount: 3,
        items: files
          .filter((f) => f.status === 'matched')
          .map((f, i) => ({
            sourcePath: f.path,
            destinationPath:
              i === 0 && policy === 'keep-both'
                ? f.destinationPath!.replace('.pdf', ' (1).pdf')
                : f.destinationPath!,
            ruleName: f.ruleName!,
            dateSource: 'modified',
            dateUsed: f.dateUsed!,
            stamp: f.stamp,
            conflict: i === 0,
            action: i === 0 && policy === 'skip' ? 'skip' : 'move',
          })),
      }) satisfies OrganizationPlan,
    execute: async () => {
      throw { code: 'DESKTOP_REQUIRED' };
    },
    history: async () => [],
    undo: async () => {
      throw { code: 'DESKTOP_REQUIRED' };
    },
    cancel: async () => {},
  };
}
