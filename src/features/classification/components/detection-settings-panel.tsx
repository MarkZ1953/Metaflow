import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
import { useDetectionSettingsStore } from '../store/detection-settings-store';
import { useClassificationStore } from '../store/classification-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { isDesktop } from '../../inbox/services/inbox-service';
import type { ClassificationSettings } from '../services/classification-service';

export function DetectionSettingsPanel() {
  const state = useDetectionSettingsStore();
  const busy = useWorkflowStore((entry) => entry.busy);
  const [clearOpen, setClearOpen] = useState(false);
  const { settings, correctionCount, ocrAvailable, ocrLanguages } = state.snapshot;
  const disabled = busy || state.loading || !state.loaded || !isDesktop;
  useEffect(() => {
    if (isDesktop) void useDetectionSettingsStore.getState().load();
  }, []);
  const clear = async () => {
    const sessionId = useClassificationStore.getState().review?.sessionId;
    const entries = await state.clearCorrections();
    if (entries === null) return;
    if (sessionId)
      useClassificationStore.getState().updateCategories(sessionId, entries, t.correctionsCleared);
    setClearOpen(false);
  };
  return (
    <>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Stack>
            <Typography variant="subtitle2">{t.detectionSettings}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t.correctionCount(correctionCount)}
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t.detectionSettingsHint}
            </Typography>
            {state.error && (
              <Alert
                severity="error"
                action={
                  <Button disabled={busy || state.loading} onClick={() => void state.load()}>
                    {t.retrySettings}
                  </Button>
                }
              >
                {state.error}
              </Alert>
            )}
            {state.notice && <Alert severity="info">{state.notice}</Alert>}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                select
                fullWidth
                size="small"
                label={t.sensitivity}
                value={settings.sensitivity}
                disabled={disabled}
                helperText={t.sensitivityHint}
                onChange={(event) =>
                  void state.save({
                    sensitivity: event.target.value as ClassificationSettings['sensitivity'],
                  })
                }
              >
                <MenuItem value="conservative">{t.sensitivityConservative}</MenuItem>
                <MenuItem value="balanced">{t.sensitivityBalanced}</MenuItem>
                <MenuItem value="broad">{t.sensitivityBroad}</MenuItem>
              </TextField>
              <TextField
                select
                fullWidth
                size="small"
                label={t.analysisMode}
                value={settings.analysisMode}
                disabled={disabled}
                helperText={t.analysisHint}
                onChange={(event) =>
                  void state.save({
                    analysisMode: event.target.value as ClassificationSettings['analysisMode'],
                  })
                }
              >
                <MenuItem value="fast">{t.analysisFast}</MenuItem>
                <MenuItem value="thorough">{t.analysisThorough}</MenuItem>
              </TextField>
            </Stack>
            <Stack spacing={0.5}>
              <FormControlLabel
                label={t.readText}
                control={
                  <Checkbox
                    disabled={disabled || ocrAvailable === false}
                    checked={settings.readText}
                    onChange={(_, readText) => void state.save({ readText })}
                  />
                }
              />
              {ocrAvailable !== undefined && (
                <Typography variant="caption" color="text.secondary">
                  {ocrAvailable ? t.ocrAvailable : t.ocrUnavailable}
                  {ocrAvailable && ocrLanguages?.length ? ` (${ocrLanguages.join(', ')})` : ''}
                </Typography>
              )}
            </Stack>
            <Stack spacing={0.5}>
              <FormControlLabel
                label={t.useCorrections}
                control={
                  <Checkbox
                    disabled={disabled}
                    checked={settings.useCorrections}
                    onChange={(_, useCorrections) => void state.save({ useCorrections })}
                  />
                }
              />
              <Typography variant="caption" color="text.secondary">
                {t.correctionsHint}
              </Typography>
            </Stack>
            <div>
              <Button disabled={disabled || !correctionCount} onClick={() => setClearOpen(true)}>
                {t.clearCorrections}
              </Button>
            </div>
          </Stack>
        </AccordionDetails>
      </Accordion>
      <Dialog
        open={clearOpen}
        data-review-shortcut-scope="classification-detection-settings"
        onClose={() => {
          if (!busy) setClearOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t.clearCorrectionsTitle}</DialogTitle>
        <DialogContent>
          <Typography>{t.clearCorrectionsHint}</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setClearOpen(false)}>
            {t.close}
          </Button>
          <Button
            disabled={disabled || !correctionCount}
            onClick={() => void clear()}
            color="warning"
            variant="contained"
          >
            {t.clearCorrections}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
