import { Chip, Stack } from '@mui/material';
import type { OrganizationPlan } from '../../inbox/schemas/inbox-schema';
import { folderName } from '../../../shared/utils/format';
import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
export function PlanSummary({ plan }: { plan: OrganizationPlan }) {
  const files = plan.items.filter((i) => !i.backup && i.entryKind !== 'directory');
  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      <Chip
        variant="outlined"
        label={`${files.length || plan.items.filter((i) => i.backup).length} ${w.files}`}
      />
      <Chip
        variant="outlined"
        label={`${w.renameAction} · ${files.filter((i) => i.action !== 'skip' && folderName(i.sourcePath) !== folderName(i.destinationPath)).length}`}
      />
      <Chip
        variant="outlined"
        label={`${w.mover} · ${files.filter((i) => i.action === 'move').length}`}
      />
      <Chip
        variant="outlined"
        label={`${w.copiar} · ${files.filter((i) => i.action === 'copy').length}`}
      />
      <Chip
        variant="outlined"
        label={`${w.duplicados} · ${files.filter((i) => i.duplicates?.length).length}`}
      />
      <Chip
        variant="outlined"
        label={`${w.nameConflicts} · ${files.filter((i) => i.conflict).length}`}
      />
      {!!plan.items.filter((i) => i.backup).length && (
        <Chip
          variant="outlined"
          color="warning"
          label={`${w.backupAction} · ${plan.items.filter((i) => i.backup).length}`}
        />
      )}
      {!!plan.items.filter((i) => i.entryKind === 'directory').length && (
        <Chip
          variant="outlined"
          label={`${w.folderSteps} · ${plan.items.filter((i) => i.entryKind === 'directory').length}`}
        />
      )}
    </Stack>
  );
}
