import { workspaceMessages as w } from '../../../shared/constants/workspace-messages';
import { useState } from 'react';
import {
  Box,
  Stack,
  Button,
  IconButton,
  ListItemButton,
  ListItemText,
  Typography,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from '@mui/material';
import AddRounded from '@mui/icons-material/AddRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import { useWorkspaceStore } from '../store/workspace-store';
import { useExplorerStore } from '../../explorer/store/explorer-store';
import { useWorkflowStore } from '../../inbox/store/workflow-store';
import { workspaceService, type FolderProperties } from '../services/workspace-service';
import { formatDateTime } from '../../../shared/utils/format';
interface Node {
  path: string;
  name: string;
  rootId?: string;
  depth: number;
}
import { isFileDrag, readFileDrag } from '../services/workspace-drag';
function FolderNode({ path, name, rootId, depth }: Node) {
  const {
    children,
    expanded,
    loading,
    expand,
    navigate,
    newFolder,
    remove,
    favorite,
    workspace,
    openLocation,
  } = useWorkspaceStore();
  const selected = useExplorerStore((s) => s.listing?.path === path);
  const busy = useWorkflowStore((s) => s.busy);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [dialog, setDialog] = useState<'new' | 'rename' | 'properties' | null>(null);
  const [newName, setNewName] = useState('');
  const [properties, setProperties] = useState<FolderProperties | null>(null);
  const [propertiesError, setPropertiesError] = useState('');
  return (
    <>
      <Box role="treeitem" aria-expanded={!!expanded[path]} aria-selected={selected}>
        <ListItemButton
          selected={selected}
          disabled={busy}
          onClick={() => void navigate(path)}
          onDragOver={(e) => {
            if (!busy && isFileDrag(e.dataTransfer)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(e) => {
            if (!busy && isFileDrag(e.dataTransfer)) {
              e.preventDefault();
              e.stopPropagation();
              useWorkspaceStore.getState().prepare(readFileDrag(e.dataTransfer), path);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setAnchor({ left: e.clientX, top: e.clientY });
          }}
          title={path}
          sx={{ pl: depth * 1.6, py: 0.3, minHeight: 32 }}
        >
          <IconButton
            size="small"
            aria-label={`${expanded[path] ? w.contraer : w.expandir} ${name}`}
            disabled={loading[path]}
            onClick={(e) => {
              e.stopPropagation();
              void expand(path);
            }}
          >
            {expanded[path] ? (
              <ExpandMoreRounded sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRounded sx={{ fontSize: 18 }} />
            )}
          </IconButton>
          <FolderOutlined sx={{ fontSize: 17, mr: 0.7, color: 'primary.light' }} />
          <ListItemText primary={name} slotProps={{ primary: { noWrap: true, fontSize: 12 } }} />
        </ListItemButton>
        {expanded[path] && (
          <Box role="group">
            {loading[path] ? (
              <Typography variant="caption" sx={{ pl: 3 + depth * 2 }}>
                {w.leyendo}
              </Typography>
            ) : (
              children[path]?.map((child) => (
                <FolderNode
                  key={child.path}
                  path={child.path}
                  name={child.name}
                  depth={depth + 1}
                />
              ))
            )}
          </Box>
        )}
      </Box>
      <Menu
        open={!!anchor}
        anchorReference="anchorPosition"
        anchorPosition={anchor ?? undefined}
        onClose={() => setAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setDialog('new');
            setNewName('');
          }}
        >
          {w.nuevaCarpeta}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setDialog('rename');
            setNewName(name);
          }}
        >
          {w.renombrarCarpeta}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            useWorkspaceStore.getState().prepare([path], '', 'move');
          }}
        >
          {w.moverCarpeta}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            useWorkspaceStore.getState().prepare([path], '', 'copy');
          }}
        >
          {w.copiarCarpeta}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void favorite(path);
          }}
        >
          {workspace.favorites.includes(path) ? w.quitarDeFavoritos : w.agregarAFavoritos}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void openLocation(path);
          }}
        >
          {w.mostrarEnWindowsExplorer}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void navigator.clipboard
              .writeText(path)
              .catch(() => useWorkspaceStore.setState({ error: w.noSePudoCopiarLaRuta }));
          }}
        >
          {w.copiarRuta}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setDialog('properties');
            setProperties(null);
            setPropertiesError('');
            void workspaceService
              .properties(path)
              .then(setProperties)
              .catch(() => setPropertiesError(w.noSePudoAbrirLaUbicacionCompruebaQue));
          }}
        >
          {w.propiedades}
        </MenuItem>
        {rootId && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              void remove(rootId);
            }}
          >
            {w.quitarDelWorkspace}
          </MenuItem>
        )}
      </Menu>
      <Dialog open={!!dialog} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialog === 'new'
            ? w.nuevaCarpeta
            : dialog === 'rename'
              ? w.renombrarCarpeta
              : w.propiedadesDeCarpeta}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ overflowWrap: 'anywhere', mb: 2 }}>{path}</Typography>
          {dialog !== 'properties' ? (
            <TextField
              autoFocus
              fullWidth
              label={w.nombre}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          ) : (
            <Box>
              {propertiesError ? (
                <Alert severity="error">{propertiesError}</Alert>
              ) : properties ? (
                <Stack spacing={1}>
                  <Typography>
                    {w.folderCreated}: {formatDateTime(properties.createdAt)}
                  </Typography>
                  <Typography>
                    {w.folderModified}: {formatDateTime(properties.modifiedAt)}
                  </Typography>
                  <Typography>
                    {w.folderAccessed}: {formatDateTime(properties.accessedAt)}
                  </Typography>
                  <Typography>
                    {w.readonly}: {properties.readonly ? w.yes : w.no}
                  </Typography>
                  <Alert severity="info">{w.laCarpetaSeCargaAlNavegarOExpandir}</Alert>
                </Stack>
              ) : (
                <Typography>{w.propertiesLoading}</Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{w.cerrar}</Button>
          {dialog !== 'properties' && (
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                if (dialog === 'new') {
                  void newFolder(path, newName);
                } else {
                  const parent = path.replace(/[\\/][^\\/]+$/, '');
                  useWorkspaceStore.getState().prepare([path], parent);
                  void useWorkspaceStore.getState().preview({
                    sources: [path],
                    destination: parent,
                    mode: 'move',
                    policy: 'skip',
                    folderName: newName,
                    duplicateAction: 'keep-both',
                  });
                }
                setDialog(null);
              }}
            >
              {dialog === 'new' ? w.crearCarpeta : w.verPreview}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
export function FolderTree() {
  const { workspace, add, navigate } = useWorkspaceStore();
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="overline" color="text.disabled" sx={{ px: 1.2 }}>
        {w.workspace}
      </Typography>
      <Button
        size="small"
        startIcon={<AddRounded />}
        onClick={() => void add()}
        sx={{ fontSize: 11, mb: 1 }}
      >
        {w.agregarCarpeta}
      </Button>
      <Box role="tree" aria-label={w.carpetasDelWorkspace}>
        {workspace.roots.map((r) => (
          <FolderNode key={r.id} path={r.path} name={r.name} rootId={r.id} depth={0} />
        ))}
      </Box>
      {!!workspace.favorites.length && (
        <>
          <Typography
            variant="overline"
            color="text.disabled"
            sx={{ display: 'block', px: 1.2, mt: 2 }}
          >
            {w.favoritos}
          </Typography>
          {workspace.favorites.map((path) => (
            <ListItemButton key={path} onClick={() => void navigate(path)} title={path}>
              <StarOutlineRounded sx={{ fontSize: 17, mr: 1 }} />
              <ListItemText
                primary={path.split(/[\\/]/).at(-1) || path}
                slotProps={{ primary: { noWrap: true, fontSize: 12 } }}
              />
            </ListItemButton>
          ))}
        </>
      )}
    </Box>
  );
}
