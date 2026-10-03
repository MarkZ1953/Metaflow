import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import type { MediaEntry } from '../services/classification-service';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import { formatDateTime, formatSize } from '../../../shared/utils/format';
import { MediaPreview } from './media-preview';
import { classificationError } from '../services/classification-error';
interface Props {
  sessionId: string;
  entry: MediaEntry;
  index: number;
  count: number;
  busy: boolean;
  excluded: boolean;
  onClose(): void;
  onNavigate(direction: -1 | 1): void;
  onProtect(value: boolean, advance?: boolean): void;
  onRemove(): void;
  onCorrect(): void;
}
export function MediaReviewDialog({
  sessionId,
  entry,
  index,
  count,
  busy,
  excluded,
  onClose,
  onNavigate,
  onProtect,
  onRemove,
  onCorrect,
}: Props) {
  return (
    <Dialog
      open
      data-review-shortcut-scope="classification-review"
      fullWidth
      maxWidth="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      slotProps={{ paper: { sx: { maxHeight: '94vh' } } }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        <Typography component="span" variant="h3" title={entry.path}>
          {entry.name}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          color="text.secondary"
          sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
        >
          {entry.path}
        </Typography>
        <IconButton
          aria-label={t.close}
          aria-keyshortcuts="Escape"
          disabled={busy}
          onClick={onClose}
          sx={{ position: 'absolute', top: 10, right: 10 }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <MediaPreview
          key={`${sessionId}:${entry.id}:expanded`}
          sessionId={sessionId}
          entry={entry}
          expanded
        />
        <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {entry.corrected && (
              <Chip size="small" color="primary" variant="outlined" label={t.correctedBadge} />
            )}
            {entry.learned && !entry.corrected && (
              <Chip size="small" color="info" variant="outlined" label={t.learnedBadge} />
            )}
            {entry.labels.map((label) => (
              <Chip
                key={label.category}
                size="small"
                variant="outlined"
                label={t.categories[label.category]}
              />
            ))}
            {entry.protected && <Chip size="small" color="success" label={t.protected} />}
            {excluded && <Chip size="small" color="warning" label={t.excludedBadge} />}
            {entry.uncertain && (
              <Chip size="small" color="warning" variant="outlined" label={t.uncertain} />
            )}
          </Box>
          {entry.uncertain && (
            <Typography variant="body2" color="text.secondary">
              {t.uncertainHint}
            </Typography>
          )}
          {entry.status === 'error' && (
            <Alert severity="warning">
              {entry.error ? classificationError({ code: entry.error }) : t.errorState}
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            {t.size}: {formatSize(entry.stamp.size)} · {t.created}:{' '}
            {formatDateTime(entry.stamp.createdAt)} · {t.modified}:{' '}
            {formatDateTime(entry.stamp.modifiedAt)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t.reviewShortcuts}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 2, flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Button
            size="small"
            aria-keyshortcuts="ArrowLeft"
            startIcon={<ArrowBackRounded />}
            disabled={busy || index <= 0}
            onClick={() => onNavigate(-1)}
          >
            {t.previous}
          </Button>
          <Typography variant="caption">{index >= 0 ? `${index + 1} / ${count}` : '—'}</Typography>
          <Button
            size="small"
            aria-keyshortcuts="ArrowRight"
            endIcon={<ArrowForwardRounded />}
            disabled={busy || index < 0 || index >= count - 1}
            onClick={() => onNavigate(1)}
          >
            {t.next}
          </Button>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Button size="small" disabled={busy} onClick={onCorrect}>
            {t.correctCategories}
          </Button>
          {entry.protected && (
            <Button size="small" disabled={busy} onClick={() => onProtect(false)}>
              {t.unprotect}
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            color="success"
            aria-keyshortcuts="c"
            disabled={busy}
            onClick={() => onProtect(true, true)}
          >
            {t.keepNext}
          </Button>
          <Button
            size="small"
            color="error"
            variant="outlined"
            aria-keyshortcuts="Delete"
            startIcon={<DeleteOutlineRounded />}
            disabled={busy || entry.protected || excluded}
            onClick={onRemove}
          >
            {t.remove}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
