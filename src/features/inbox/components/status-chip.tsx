import { Chip } from '@mui/material';
import { messages as t } from '../../../shared/constants/messages';
export function StatusChip({ status }: { status: string }) {
  const color =
    status === 'matched' || status === 'completed'
      ? 'success'
      : status === 'failed' || status === 'recovery-required'
        ? 'error'
        : status === 'needs-review' || status === 'partial'
          ? 'warning'
          : 'default';
  return (
    <Chip size="small" variant="outlined" color={color} label={t.statusLabels[status] ?? status} />
  );
}
