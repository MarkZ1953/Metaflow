import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useRenameStore } from '../store/rename-store';
import {
  renameService,
  templates,
  type RenamePreset,
  presetSchema,
} from '../services/rename-service';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { friendlyError } from '../../../shared/services/app-error';
export function RenamePresetsView() {
  const { configuration, save, error, loading } = useRenameStore();
  const { snapshot, busy } = useWorkflowStore();
  const [draft, setDraft] = useState<RenamePreset | null>(null);
  const [sample, setSample] = useState('');
  const [localError, setLocalError] = useState('');
  async function saveDraft() {
    if (!draft) return;
    const parsed = presetSchema.safeParse(draft);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? w.presetInvalido);
      return;
    }
    if (
      await save({
        ...configuration,
        presets: [...configuration.presets.filter((p) => p.id !== draft.id), parsed.data],
      })
    ) {
      setDraft(null);
      setLocalError('');
    }
  }
  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, p: 3, overflow: 'auto' }}>
      <Typography variant="h2">{w.presetsDeNombres}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        {w.elInboxLasReglasYLasTransferenciasComparten}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        {templates.map((template) => (
          <Button
            key={template.name}
            disabled={loading || busy}
            variant="outlined"
            onClick={() => {
              setDraft({ ...template, id: crypto.randomUUID() });
              setSample('');
              setLocalError('');
            }}
          >
            + {template.name}
          </Button>
        ))}
      </Stack>
      <Stack spacing={2}>
        {configuration.presets.map((p) => (
          <Card key={p.id} variant="outlined">
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={600}>{p.name}</Typography>
                  <Typography component="code" variant="caption">
                    {p.format}
                  </Typography>
                </Box>
                <Button
                  disabled={busy || loading}
                  onClick={() => {
                    setDraft(p);
                    setSample('');
                    setLocalError('');
                  }}
                >
                  {w.editar}
                </Button>
                <Button
                  disabled={busy || loading}
                  onClick={() =>
                    void save({
                      ...configuration,
                      presets: configuration.presets.filter((x) => x.id !== p.id),
                      inboxPresetId:
                        configuration.inboxPresetId === p.id ? null : configuration.inboxPresetId,
                      rulePresets: Object.fromEntries(
                        Object.entries(configuration.rulePresets).filter(([, id]) => id !== p.id),
                      ),
                    })
                  }
                >
                  {w.eliminarPreset}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <TextField
        select
        fullWidth
        label={w.presetPredeterminadoDelInbox}
        value={configuration.inboxPresetId ?? ''}
        disabled={busy || loading}
        sx={{ mt: 3 }}
        onChange={(e) => void save({ ...configuration, inboxPresetId: e.target.value || null })}
      >
        <MenuItem value="">{w.conservarNombreOriginal}</MenuItem>
        {configuration.presets.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </TextField>
      {snapshot.rules.map((rule) => (
        <TextField
          key={rule.id}
          select
          fullWidth
          label={`Regla: ${rule.name}`}
          value={configuration.rulePresets[rule.id] ?? ''}
          disabled={busy || loading}
          sx={{ mt: 2 }}
          onChange={(e) => {
            const bindings = { ...configuration.rulePresets };
            if (e.target.value) bindings[rule.id] = e.target.value;
            else delete bindings[rule.id];
            void save({ ...configuration, rulePresets: bindings });
          }}
        >
          <MenuItem value="">{w.usarPresetDelInbox}</MenuItem>
          {configuration.presets.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
      ))}
      <Dialog
        open={!!draft}
        fullWidth
        maxWidth="sm"
        onClose={loading ? undefined : () => setDraft(null)}
      >
        <DialogTitle>{w.formatoDeNombre}</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {localError && <Alert severity="error">{localError}</Alert>}
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label={w.nombreDelPreset}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <TextField
                label={w.formato}
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value })}
                helperText="{name} · {period} · {year} · {month} · {day} · {date:yyyy-MM-dd} · {date:yyyyMMdd} · {counter:0001}"
              />
              <TextField
                select
                label={w.mayusculasYMinusculas}
                value={draft.letterCase}
                onChange={(e) =>
                  setDraft({ ...draft, letterCase: e.target.value as RenamePreset['letterCase'] })
                }
              >
                {[
                  ['unchanged', w.conservar],
                  ['lower', w.minusculas],
                  ['upper', 'MAYÚSCULAS'],
                  ['title', w.titulo],
                ].map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={w.espacios}
                value={draft.spaceReplacement}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    spaceReplacement: e.target.value as RenamePreset['spaceReplacement'],
                  })
                }
              >
                <MenuItem value="unchanged">{w.conservar}</MenuItem>
                <MenuItem value="dash">{w.usarGuiones}</MenuItem>
                <MenuItem value="underscore">{w.usarGuionesBajos}</MenuItem>
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.collapseSpaces}
                    onChange={(_, checked) => setDraft({ ...draft, collapseSpaces: checked })}
                  />
                }
                label={w.eliminarEspaciosDuplicados}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.removeAccents}
                    onChange={(_, checked) => setDraft({ ...draft, removeAccents: checked })}
                  />
                }
                label={w.quitarTildes}
              />
              <Button
                variant="outlined"
                onClick={() =>
                  void renameService
                    .sample(
                      draft,
                      w.tareaFinalProgramacionPdf,
                      w.periodo,
                      new Date(2026, 8, 21, 12).getTime(),
                    )
                    .then(setSample)
                    .catch((error) => setLocalError(friendlyError(error)))
                }
              >
                {w.probarConTareaFinalProgramacionPdf}
              </Button>
              {sample && (
                <Alert severity="success" sx={{ overflowWrap: 'anywhere' }}>
                  {sample}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={loading} onClick={() => setDraft(null)}>
            {w.cancelar}
          </Button>
          <Button variant="contained" disabled={loading || busy} onClick={() => void saveDraft()}>
            {w.guardar}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
