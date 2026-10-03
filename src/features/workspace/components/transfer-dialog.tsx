import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useWorkspaceStore } from '../store/workspace-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { VirtualTable } from '../../../shared/components/virtual-table';
import { formatSize } from '../../../shared/utils/format';
import { PlanIssues } from '../../organizer/components/plan-issues';
import { PlanSummary } from '../../organizer/components/plan-summary';
import { useRenameStore } from '../../rename/store/rename-store';
export function TransferDialog() {
  const {
    pendingSources,
    pendingDestination,
    pendingMode,
    cleanup,
    workspace,
    plan,
    request,
    error,
    preview,
    execute,
    close,
  } = useWorkspaceStore();
  const busy = useWorkflowStore((s) => s.busy);
  const [destination, setDestination] = useState(pendingDestination);
  const [mode, setMode] = useState<'move' | 'copy'>(pendingMode);
  const [policy, setPolicy] = useState<'skip' | 'keep-both' | 'replace'>('skip');
  const presets = useRenameStore((s) => s.configuration.presets);
  const [presetId, setPresetId] = useState('');
  const [period, setPeriod] = useState('');
  if (!pendingSources.length) return null;
  const target = destination || pendingDestination;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="lg"
      onClose={busy ? undefined : close}
      slotProps={{ paper: { sx: { height: plan ? '82vh' : undefined } } }}
    >
      <DialogTitle>
        {cleanup ? w.consolidarDuplicados : w.transferencia} · {pendingSources.length}
        {w.elementos}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {!plan ? (
          <>
            <Alert severity="info">{w.seVerificaraElContenidoAntesDeTransferirCancelar}</Alert>
            <TextField
              select
              label={w.destinoRapido}
              value={workspace.roots.some((r) => r.path === target) ? target : ''}
              onChange={(e) => setDestination(e.target.value)}
            >
              <MenuItem value="">{w.elegirUnaCarpetaDelArbolOEscribirUna}</MenuItem>
              {workspace.roots.map((r) => (
                <MenuItem key={r.id} value={r.path}>
                  {r.name} · {r.path}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={w.carpetaDeDestinoEnElWorkspace}
              fullWidth
              value={target}
              onChange={(e) => setDestination(e.target.value)}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label={w.presetDeNombres}
                fullWidth
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                <MenuItem value="">{w.conservarNombres}</MenuItem>
                {presets.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                label={w.periodoParaPeriod}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={!presetId}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label={w.accion}
                value={mode}
                onChange={(e) => setMode(e.target.value as 'move' | 'copy')}
                fullWidth
              >
                <MenuItem value="move">{w.mover}</MenuItem>
                <MenuItem value="copy">{w.copiar}</MenuItem>
              </TextField>
              <TextField
                select
                label={w.siElNombreExiste}
                value={policy}
                onChange={(e) => setPolicy(e.target.value as 'skip' | 'keep-both' | 'replace')}
                fullWidth
              >
                <MenuItem value="skip">{w.omitir}</MenuItem>
                <MenuItem value="keep-both">{w.conservarAmbos}</MenuItem>
                <MenuItem value="replace">{w.reemplazarConRespaldo}</MenuItem>
              </TextField>
            </Stack>
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
              {w.origen}
              {pendingSources.slice(0, 3).join(' · ')}
              {pendingSources.length > 3 ? ' …' : ''}
            </Typography>
          </>
        ) : (
          <>
            <Typography>
              {plan.items.filter((i) => i.action !== 'skip').length}
              {w.transferencias} {plan.items.filter((i) => i.conflict).length}
              {w.conflictos}{' '}
              {formatSize(
                plan.items
                  .filter((i) => i.action !== 'skip')
                  .reduce((sum, i) => sum + i.stamp.size, 0),
              )}
            </Typography>
            <PlanSummary plan={plan} />
            <PlanIssues
              plan={plan}
              busy={busy}
              policy={request?.policy ?? policy}
              duplicateAction={request?.duplicateAction ?? 'skip'}
              resolutions={request?.resolutions ?? {}}
              onRebuild={async (policy, duplicateAction, resolutions) => {
                if (request) await preview({ ...request, policy, duplicateAction, resolutions });
              }}
            />
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <VirtualTable
                rows={plan.items}
                rowKey={(i) => `${i.sourcePath}|${i.action}|${i.destinationPath}`}
                label={w.previewDeTransferencia}
                columns={[
                  {
                    label: w.from,
                    width: 'minmax(300px,1fr)',
                    render: (i) => (
                      <Typography variant="caption" title={i.sourcePath}>
                        {i.sourcePath}
                      </Typography>
                    ),
                  },
                  {
                    label: w.to,
                    width: 'minmax(300px,1fr)',
                    render: (i) => (
                      <Typography variant="caption" title={i.destinationPath}>
                        {i.destinationPath}
                      </Typography>
                    ),
                  },
                  {
                    label: w.accion,
                    width: '100px',
                    render: (i) =>
                      i.backup
                        ? w.respaldar
                        : i.action === 'mkdir'
                          ? w.crearCarpeta
                          : i.action === 'rmdir'
                            ? w.retirarVacA
                            : i.action === 'copy'
                              ? w.copiar
                              : i.action === 'move'
                                ? w.mover
                                : w.omitir,
                  },
                ]}
              />
            </Box>
            <Alert severity="info">{w.undoCompruebaIntegridadYConflictosLasCopiasDeshechas}</Alert>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          {w.cancelar}
        </Button>
        {plan ? (
          <>
            <Button
              disabled={busy || cleanup}
              onClick={() => useWorkspaceStore.setState({ plan: null })}
            >
              {w.editar}
            </Button>
            <Button
              variant="contained"
              disabled={busy || !plan.items.some((i) => i.action !== 'skip')}
              onClick={() => void execute()}
            >
              {w.ejecutar}
              {request?.mode === 'copy' ? 'copia' : 'movimiento'}
            </Button>
          </>
        ) : (
          <Button
            disabled={busy || !target}
            variant="contained"
            onClick={() =>
              void preview({
                sources: pendingSources,
                destination: target,
                mode,
                policy,
                presetId: presetId || null,
                period,
              })
            }
          >
            {w.verPreview}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
