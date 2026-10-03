import { Box, Drawer, Stack, Typography, Divider } from '@mui/material';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { ActionButton } from '../../../shared/components/action-button';
import { messages as t } from '../../../shared/constants/messages';
import { formatDateTime, formatSize } from '../../../shared/utils/format';
import { friendlyError } from '../../../shared/services/app-error';
import { StatusChip } from './status-chip';
import type { InboxFile } from '../schemas/inbox-schema';

export function InboxDetails({ file, onClose }: { file: InboxFile | null; onClose(): void }) {
  return (
    <Drawer
      anchor="right"
      open={!!file}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 380, maxWidth: '100%' } } }}
    >
      {file && (
        <Stack spacing={2.5} sx={{ p: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h3">{t.inspect}</Typography>
            <ActionButton label={t.close} icon={CloseRounded} onClick={onClose} />
          </Stack>
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>
            {file.name}
          </Typography>
          <Box>
            <StatusChip status={file.status} />
          </Box>
          <Divider />
          {[
            [t.path, file.path],
            [t.extension, file.extension || '—'],
            [t.size, formatSize(file.stamp.size)],
            [t.created, formatDateTime(file.stamp.createdAt)],
            [t.modified, formatDateTime(file.stamp.modifiedAt)],
            [t.accessed, formatDateTime(file.accessedAt)],
            [t.rule, file.ruleName ?? t.unmatched],
            [t.destination, file.destinationPath ?? t.keepInbox],
          ].map(([label, value]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography sx={{ overflowWrap: 'anywhere', mt: 0.4 }}>{value}</Typography>
            </Box>
          ))}
          {file.error && (
            <Typography color="error.main">{friendlyError({ code: file.error })}</Typography>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
