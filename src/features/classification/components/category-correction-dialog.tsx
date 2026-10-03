import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import type { MediaCategory, MediaEntry } from '../services/classification-service';
import { useClassificationStore } from '../store/classification-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { MediaPreview } from './media-preview';

interface Props {
  sessionId: string;
  entries: MediaEntry[];
  onClose(): void;
}
export function CategoryCorrectionDialog({ sessionId, entries, onClose }: Props) {
  const busy = useWorkflowStore((entry) => entry.busy);
  const state = useClassificationStore();
  const [categories, setCategories] = useState<MediaCategory[]>(
    entries.length === 1 ? entries[0]!.labels.map((label) => label.category) : [],
  );
  const validSession = state.review?.sessionId === sessionId;
  const submit = async (value: MediaCategory[] | null) => {
    const current = useClassificationStore.getState();
    if (useWorkflowStore.getState().busy || current.review?.sessionId !== sessionId) return;
    if (
      await current.correctCategories(
        entries.map((entry) => entry.id),
        value,
      )
    )
      onClose();
  };
  return (
    <Dialog
      open
      data-review-shortcut-scope="classification-correction"
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <DialogTitle>
        {t.correctionTitle} · {entries.length}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{t.correctionHint}</Typography>
          {entries.length > 1 && <Alert severity="info">{t.correctionBatchHint}</Alert>}
          {state.error && <Alert severity="error">{state.error}</Alert>}
          {entries.length === 1 && (
            <MediaPreview
              key={`${sessionId}:${entries[0]!.id}:correction`}
              sessionId={sessionId}
              entry={entries[0]!}
            />
          )}
          <Box
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.5 }}
          >
            {Object.entries(t.categories).map(([value, label]) => {
              const category = value as MediaCategory;
              return (
                <FormControlLabel
                  key={category}
                  label={label}
                  control={
                    <Checkbox
                      checked={categories.includes(category)}
                      disabled={busy || !validSession}
                      onChange={(_, checked) =>
                        setCategories((current) =>
                          checked
                            ? [...new Set([...current, category])]
                            : current.filter((entry) => entry !== category),
                        )
                      }
                    />
                  }
                />
              );
            })}
          </Box>
          {!categories.length && (
            <Typography variant="caption" color="text.secondary">
              {t.correctionRequired}
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 140, overflow: 'auto' }}>
            {entries.map((entry) => (
              <Typography
                component="li"
                variant="caption"
                key={entry.id}
                sx={{ overflowWrap: 'anywhere' }}
              >
                {entry.path}
              </Typography>
            ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={busy || !validSession} onClick={() => void submit(null)}>
          {t.correctionReset}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button disabled={busy} onClick={onClose}>
          {t.close}
        </Button>
        <Button
          disabled={busy || !validSession || !categories.length}
          onClick={() => void submit(categories)}
          variant="contained"
        >
          {t.saveCorrection}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
