import { Box, Button, Checkbox, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import BookmarkRounded from '@mui/icons-material/BookmarkRounded';
import type { MediaEntry } from '../services/classification-service';
import { MediaPreview } from './media-preview';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import { formatSize } from '../../../shared/utils/format';
interface Props {
  entry: MediaEntry;
  sessionId: string;
  selected: boolean;
  excluded: boolean;
  busy: boolean;
  onSelect(value: boolean): void;
  onOpen(): void;
  onProtect(value: boolean): void;
  onInclude(): void;
  onCorrect(): void;
}
export function MediaCard({
  entry,
  sessionId,
  selected,
  excluded,
  busy,
  onSelect,
  onOpen,
  onProtect,
  onInclude,
  onCorrect,
}: Props) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderColor: selected
          ? 'primary.main'
          : excluded
            ? 'warning.main'
            : entry.protected
              ? 'success.main'
              : 'divider',
      }}
    >
      <MediaPreview
        key={`${sessionId}:${entry.id}`}
        sessionId={sessionId}
        entry={entry}
        onExpand={onOpen}
      />
      <Stack spacing={1} sx={{ p: 1.5, flex: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Checkbox
            checked={selected}
            disabled={busy}
            onChange={(_, value) => onSelect(value)}
            size="small"
            inputProps={{ 'aria-label': `${t.selection}: ${entry.name}` }}
            sx={{ p: 0.5 }}
          />
          <Typography variant="subtitle2" title={entry.path} noWrap sx={{ minWidth: 0, flex: 1 }}>
            {entry.name}
          </Typography>
          {entry.protected && (
            <Tooltip title={t.protectedHint}>
              <BookmarkRounded fontSize="small" color="success" />
            </Tooltip>
          )}
          {excluded && (
            <Tooltip title={t.excludedHint}>
              <Chip size="small" color="warning" variant="outlined" label={t.excludedBadge} />
            </Tooltip>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" title={entry.path} noWrap>
          {entry.path}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {entry.kind === 'image' ? t.image : t.video} · {formatSize(entry.stamp.size)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', minHeight: 26 }}>
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
          {entry.uncertain && (
            <Chip size="small" color="warning" variant="outlined" label={t.uncertain} />
          )}
          {entry.status === 'error' && (
            <Chip size="small" color="warning" variant="outlined" label={t.errorState} />
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ pt: 0.5, mt: 'auto' }}>
          <Button size="small" disabled={busy} onClick={onOpen} sx={{ flex: 1 }}>
            {t.review}
          </Button>
          {excluded ? (
            <Button size="small" disabled={busy} onClick={onInclude} sx={{ flex: 1 }}>
              {t.include}
            </Button>
          ) : (
            <Button
              size="small"
              color={entry.protected ? 'success' : 'primary'}
              variant={entry.protected ? 'outlined' : 'text'}
              disabled={busy}
              onClick={() => onProtect(!entry.protected)}
              sx={{ flex: 1 }}
            >
              {entry.protected ? t.unprotect : t.keep}
            </Button>
          )}
        </Stack>
        <Button size="small" disabled={busy} onClick={onCorrect}>
          {t.correctCategories}
        </Button>
      </Stack>
    </Paper>
  );
}
