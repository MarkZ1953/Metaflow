import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { messages as t } from '../../../shared/constants/messages';
import { formatSize } from '../../../shared/utils/format';
import { metadataMessages as m } from '../../../shared/constants/metadata-messages';
export function OperationProgress() {
  const { progress, cancel } = useWorkflowStore();
  if (!progress) return null;
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 540,
        maxWidth: '90vw',
        zIndex: 1500,
        p: 2,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'primary.main',
        borderRadius: 1.3,
        boxShadow: 8,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography fontWeight={600}>
          {progress.phase === 'undo'
            ? t.progressUndo
            : progress.phase === 'dates'
              ? m.progress
              : progress.phase === 'copy'
                ? 'Copiando archivos'
                : t.progressMove}
        </Typography>
        <Typography variant="caption">
          {progress.completed} / {progress.total} · {percent}%
        </Typography>
      </Stack>
      <LinearProgress variant={progress.total ? 'determinate' : 'indeterminate'} value={percent} />
      {!!progress.totalBytes && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
          {formatSize(progress.completedBytes ?? 0)} / {formatSize(progress.totalBytes)}
        </Typography>
      )}
      {progress.currentName && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          Actual: {progress.currentName}
        </Typography>
      )}
      <Button size="small" onClick={() => void cancel()} sx={{ mt: 1 }}>
        {t.cancelBatch}
      </Button>
    </Box>
  );
}
