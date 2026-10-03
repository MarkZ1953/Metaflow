import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { dateRuleFormSchema, hasOverlap, overlapMessage } from '../schemas/date-rule-schema';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import type { DateRule } from '../../inbox/schemas/inbox-schema';
import { messages as t } from '../../../shared/constants/messages';
import { useRenameStore } from '../../rename/store/rename-store';

export function DateRuleDialog({ draft, onClose }: { draft: DateRule; onClose(): void }) {
  const { snapshot, busy, saveRules, chooseDestination, error } = useWorkflowStore();
  const [formError, setFormError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { configuration, save: saveRename, error: renameError } = useRenameStore();
  const [presetId, setPresetId] = useState(configuration.rulePresets[draft.id] ?? '');
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DateRule>({ defaultValues: draft, resolver: zodResolver(dateRuleFormSchema) });
  const existing = snapshot.rules.some((r) => r.id === draft.id);
  const submit = handleSubmit(async (rule) => {
    if (hasOverlap(rule, snapshot.rules)) {
      setFormError(overlapMessage);
      return;
    }
    setFormError(null);
    const next = existing
      ? snapshot.rules.map((r) => (r.id === rule.id ? rule : r))
      : [...snapshot.rules, rule];
    if (await saveRules(next)) {
      const rulePresets = { ...configuration.rulePresets };
      if (presetId) rulePresets[rule.id] = presetId;
      else delete rulePresets[rule.id];
      if (
        presetId === (configuration.rulePresets[draft.id] ?? '') ||
        (await saveRename({ ...configuration, rulePresets }))
      )
        onClose();
    }
  });
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose}>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{existing ? t.editRule : t.addRule}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.4} sx={{ pt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            {renameError && <Alert severity="error">{renameError}</Alert>}
            <TextField
              autoFocus
              label={t.ruleName}
              {...register('name')}
              error={!!errors.name}
              helperText={errors.name?.message}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                type="date"
                label={t.startDate}
                {...register('startDate')}
                error={!!errors.startDate}
                helperText={errors.startDate?.message}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField
                type="date"
                label={t.endDate}
                {...register('endDate')}
                error={!!errors.endDate}
                helperText={errors.endDate?.message}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>
            <Controller
              name="dateSource"
              control={control}
              render={({ field }) => (
                <TextField select label={t.dateSource} {...field} fullWidth>
                  {Object.entries(t.sourceLabels).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              name="destinationPath"
              control={control}
              render={({ field }) => (
                <TextField
                  label={t.destination}
                  value={field.value}
                  error={!!errors.destinationPath}
                  helperText={errors.destinationPath?.message}
                  slotProps={{ input: { readOnly: true } }}
                  fullWidth
                />
              )}
            />
            <Button
              variant="outlined"
              startIcon={<FolderOpenRounded />}
              disabled={busy || picking}
              onClick={() => {
                setPicking(true);
                void chooseDestination()
                  .then((path) => {
                    if (path) setValue('destinationPath', path, { shouldValidate: true });
                  })
                  .finally(() => setPicking(false));
              }}
            >
              {t.chooseDestination}
            </Button>
            <TextField
              select
              label="Preset de nombres"
              value={presetId}
              disabled={busy}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <MenuItem value="">Usar preset del Inbox</MenuItem>
              {configuration.presets.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
            <Controller
              name="enabled"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={
                    <Switch
                      checked={field.value}
                      onChange={(_, checked) => field.onChange(checked)}
                    />
                  }
                  label={t.enabled}
                />
              )}
            />
            <Alert severity="info" sx={{ fontSize: 12 }}>
              {t.rulesHint}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || picking}>
            {t.save}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
