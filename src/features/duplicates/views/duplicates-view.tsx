import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { duplicateService, type DuplicateScan } from '../services/duplicate-service';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { useWorkspaceStore } from '../../workspace/store/workspace-store';
import { VirtualTable } from '../../../shared/components/virtual-table';
import { formatSize, formatDateTime, folderName } from '../../../shared/utils/format';
import { friendlyError } from '../../../shared/services/app-error';
export function DuplicatesView() {
  const busy = useWorkflowStore((s) => s.busy);
  const [result, setResult] = useState<DuplicateScan | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [keeper, setKeeper] = useState('');
  const [error, setError] = useState('');
  const group = result?.groups[groupIndex];
  const retained = group?.files.some((f) => f.path === keeper)
    ? keeper
    : (group?.files[0]?.path ?? '');
  async function scan() {
    useWorkflowStore.setState({ busy: true });
    setError('');
    try {
      setResult(await duplicateService.scan());
      setGroupIndex(0);
      setKeeper('');
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      useWorkflowStore.setState({ busy: false, progress: null });
    }
  }
  async function consolidate() {
    if (!group) return;
    useWorkflowStore.setState({ busy: true });
    setError('');
    try {
      const plan = await duplicateService.preview(
        retained,
        group.files.map((f) => f.path),
        group.hash,
      );
      useWorkspaceStore.setState({
        pendingSources: plan.items.map((i) => i.sourcePath),
        pendingDestination: '',
        pendingMode: 'move',
        plan,
        request: {
          sources: plan.items.map((i) => i.sourcePath),
          destination: '',
          mode: 'move',
          policy: 'skip',
        },
        cleanup: true,
      });
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      useWorkflowStore.setState({ busy: false });
    }
  }
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        p: 3,
        gap: 2,
      }}
    >
      <Stack direction="row" alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">{w.duplicados}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {w.buscaContenidoIdenticoEnLasCarpetasAdministradasEl}
          </Typography>
        </Box>
        <Button disabled={busy} variant="contained" onClick={() => void scan()}>
          {w.buscarDuplicados}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!!result?.unreadableCount && (
        <Alert severity="warning">
          {result.unreadableCount}
          {w.archivosOUbicacionesNoSePudieronComprobar}
        </Alert>
      )}
      {group ? (
        <>
          <TextField
            select
            label={w.grupoDeDuplicados}
            value={groupIndex}
            onChange={(e) => {
              setGroupIndex(Number(e.target.value));
              setKeeper('');
            }}
          >
            {result?.groups.map((g, i) => (
              <MenuItem key={g.hash} value={i}>
                {w.grupo}
                {i + 1} · {g.files.length}
                {w.archivosIdenticos}
                {formatSize(g.files[0]?.stamp.size ?? 0)}
                {w.cadaUno}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={w.archivoQueConservarasEnSuUbicacion}
            value={retained}
            disabled={busy}
            onChange={(e) => setKeeper(e.target.value)}
          >
            {group.files.map((f) => (
              <MenuItem key={f.path} value={f.path}>
                {f.path}
              </MenuItem>
            ))}
          </TextField>
          <VirtualTable
            rows={group.files}
            rowKey={(f) => f.path}
            label={w.archivosDuplicados}
            columns={[
              { label: w.nombre, width: '180px', render: (f) => folderName(f.path) },
              {
                label: w.ubicacion,
                width: 'minmax(300px,1fr)',
                render: (f) => (
                  <Typography variant="caption" title={f.path}>
                    {f.path}
                  </Typography>
                ),
              },
              { label: w.tamano, width: '100px', render: (f) => formatSize(f.stamp.size) },
              {
                label: w.fechasComparacion,
                width: '180px',
                render: (f) => (
                  <Typography variant="caption">
                    {formatDateTime(f.stamp.createdAt)}
                    <br />
                    {formatDateTime(f.stamp.modifiedAt)}
                  </Typography>
                ),
              },
              {
                label: 'BLAKE3',
                width: 'minmax(220px,1fr)',
                render: (f) => (
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
                  >
                    {f.hash}
                  </Typography>
                ),
              },
            ]}
          />
          <Alert severity="info">{w.elSeleccionadoPermaneceEnSuUbicacionElPreview}</Alert>
          <Button disabled={busy} variant="outlined" onClick={() => void consolidate()}>
            {w.revisarConsolidacionDelGrupo}
          </Button>
        </>
      ) : (
        <Box sx={{ m: 'auto', textAlign: 'center' }}>
          <Typography color="text.secondary">
            {result
              ? w.noSeEncontraronGruposDeContenidoIdentico
              : w.eligeBuscarDuplicadosParaAnalizarTusCarpetas}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
