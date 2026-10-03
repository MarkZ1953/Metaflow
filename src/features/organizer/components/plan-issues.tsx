import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type {
  OrganizationPlan,
  IssueResolution,
  ConflictPolicy,
} from '../../inbox/schemas/inbox-schema';
import { formatDateTime, formatSize, folderName } from '../../../shared/utils/format';
import { workspaceService } from '../../workspace/services/workspace-service';
import { VirtualTable } from '../../../shared/components/virtual-table';
const duplicateChoices = [
  ['keep-existing', w.conservarArchivoExistente],
  ['keep-incoming', w.conservarArchivoEntrante],
  ['keep-both', w.conservarAmbos],
  ['skip', w.omitirEntrante],
  ['replace-existing', w.reemplazarExistente],
] as const;
export function PlanIssues({
  plan,
  busy,
  policy,
  duplicateAction,
  resolutions,
  onRebuild,
}: {
  plan: OrganizationPlan;
  busy: boolean;
  policy: ConflictPolicy;
  duplicateAction: string;
  resolutions: Record<string, IssueResolution>;
  onRebuild(
    policy: ConflictPolicy,
    duplicateAction: string,
    resolutions: Record<string, IssueResolution>,
  ): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [choice, setChoice] = useState('skip');
  const [all, setAll] = useState(false);
  const [locationError, setLocationError] = useState('');
  const issues = plan.items.filter((i) => !i.backup && (i.conflict || i.duplicates?.length));
  const item = issues.find((i) => i.sourcePath === source) ?? issues[0];
  const identical = !!item?.duplicates?.length;
  const existing = identical ? (item?.duplicates ?? []) : item?.existing ? [item.existing] : [];
  async function locations() {
    if (!item) return;
    try {
      await workspaceService.openLocation(item.sourcePath);
      if (existing[0] && !existing[0].planned)
        await workspaceService.openLocation(existing[0].path);
    } catch {
      setLocationError(w.noSePudoAbrirLaUbicacionCompruebaQue);
    }
  }
  async function apply() {
    if (!item) return;
    if (all) {
      await onRebuild(
        identical ? policy : (choice as ConflictPolicy),
        identical ? choice : duplicateAction,
        {},
      );
    } else {
      await onRebuild(policy, duplicateAction, {
        ...resolutions,
        [item.sourcePath]: {
          ...resolutions[item.sourcePath],
          ...(identical
            ? { duplicateAction: choice }
            : { conflictPolicy: choice as ConflictPolicy }),
        },
      });
    }
  }
  return (
    <>
      <Button
        variant="outlined"
        disabled={busy || !issues.length}
        onClick={() => {
          setOpen(true);
          setChoice('skip');
        }}
      >
        {w.revisarIncidencias}
        {issues.length})
      </Button>
      {!!plan.unreadableCount && (
        <Alert severity="warning">
          {plan.unreadableCount}
          {w.ubicacionesNoSePudieronComprobarElAnalisisDe}
        </Alert>
      )}
      <Dialog
        open={open}
        fullWidth
        maxWidth="lg"
        onClose={busy ? undefined : () => setOpen(false)}
        slotProps={{ paper: { sx: { height: '80vh' } } }}
      >
        <DialogTitle>
          {identical ? w.archivoDuplicadoDetectado : w.elNombreDeDestinoYaExiste}
        </DialogTitle>
        <DialogContent sx={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {locationError && <Alert severity="error">{locationError}</Alert>}
          {!!issues.length && (
            <TextField
              select
              label={w.archivoEntrante}
              sx={{ mt: 1 }}
              value={item?.sourcePath ?? ''}
              onChange={(e) => {
                setSource(e.target.value);
                setChoice('skip');
              }}
            >
              {issues.map((i) => (
                <MenuItem key={i.sourcePath} value={i.sourcePath}>
                  {folderName(i.sourcePath)} ·{' '}
                  {i.duplicates?.length ? w.contenidoIdentico : w.conflictoDeNombre}
                </MenuItem>
              ))}
            </TextField>
          )}
          {item ? (
            <>
              <Alert severity={identical ? 'info' : 'warning'}>
                {identical
                  ? w.contienenLosMismosDatosTamanoYBlakeCompleto
                  : w.sonUnConflictoDeNombreComparaLosDatos}
              </Alert>
              <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
                {w.entrante} {item.sourcePath}
                <br />
                {w.destinoPrevisto} {item.destinationPath}
              </Typography>
              <Box sx={{ flex: 1, minHeight: 120, display: 'flex' }}>
                <VirtualTable
                  rows={[
                    {
                      path: item.sourcePath,
                      stamp: item.stamp,
                      hash: item.hash ?? null,
                      planned: false,
                    },
                    ...existing,
                  ]}
                  rowKey={(i) => i.path}
                  label={w.comparacionDeArchivos}
                  columns={[
                    {
                      label: w.ubicacion,
                      width: 'minmax(300px,1fr)',
                      render: (i) => (
                        <Typography variant="caption" title={i.path}>
                          {i.path}
                          {i.planned ? w.previstoEnEsteLote : ''}
                        </Typography>
                      ),
                    },
                    { label: w.tamano, width: '100px', render: (i) => formatSize(i.stamp.size) },
                    {
                      label: w.fechasComparacion,
                      width: '180px',
                      render: (i) => (
                        <Typography variant="caption">
                          {formatDateTime(i.stamp.createdAt)}
                          <br />
                          {formatDateTime(i.stamp.modifiedAt)}
                        </Typography>
                      ),
                    },
                    {
                      label: 'BLAKE3',
                      width: 'minmax(260px,1fr)',
                      render: (i) => (
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
                        >
                          {i.hash ?? '—'}
                        </Typography>
                      ),
                    },
                  ]}
                />
              </Box>
              <Stack direction="row" spacing={2} alignItems="center">
                <TextField
                  select
                  label={w.accion}
                  value={choice}
                  disabled={busy}
                  sx={{ minWidth: 260 }}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  {identical
                    ? duplicateChoices.map(([value, label]) => (
                        <MenuItem
                          key={value}
                          value={value}
                          disabled={
                            existing.some((i) => i.planned) &&
                            (value === 'keep-incoming' || value === 'replace-existing')
                          }
                        >
                          {label}
                        </MenuItem>
                      ))
                    : [
                        ['skip', w.omitir],
                        ['keep-both', w.conservarAmbos],
                        ['replace', w.reemplazarConRespaldo],
                      ].map(([value, label]) => (
                        <MenuItem key={value} value={value}>
                          {label}
                        </MenuItem>
                      ))}
                </TextField>
                <FormControlLabel
                  control={<Checkbox checked={all} onChange={(_, checked) => setAll(checked)} />}
                  label={identical ? w.aplicarATodosLosDuplicados : w.aplicarATodosLosConflictos}
                />
              </Stack>
              <Alert severity="info">{w.omitirConservaElEntranteEnOrigenReemplazarConserva}</Alert>
            </>
          ) : (
            <Alert severity="success">{w.noQuedanIncidenciasEnEstePreview}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void locations()} disabled={busy || !item}>
            {w.abrirUbicaciones}
          </Button>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {w.volverAlPreview}
          </Button>
          <Button variant="contained" disabled={busy || !item} onClick={() => void apply()}>
            {w.actualizarPreview}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
