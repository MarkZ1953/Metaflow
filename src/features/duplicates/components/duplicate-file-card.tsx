import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import type { ComparisonSide, DuplicateFile, DuplicateImage } from '../services/duplicate-service';
import { duplicatePreview } from '../services/preview-cache';
import { duplicateMessages as t } from '../../../shared/constants/duplicate-messages';
import { friendlyError } from '../../../shared/services/app-error';
import { folderName, formatDateTime, formatSize } from '../../../shared/utils/format';

const imageExtension = /\.(?:jpe?g|png|webp|gif|bmp|tiff?|ico|avif|heic|heif)$/i;
interface Props {
  file: DuplicateFile;
  sessionId: string;
  comparisonId: string;
  side: ComparisonSide;
  busy: boolean;
  canRemove: boolean;
  selected: boolean;
  onSelect(side: ComparisonSide): void;
  onPreviewReady(side: ComparisonSide, ready: boolean): void;
  onRemove(side: ComparisonSide): void;
}
export function DuplicateFileCard({
  file,
  sessionId,
  comparisonId,
  side,
  busy,
  canRemove,
  selected,
  onSelect,
  onPreviewReady,
  onRemove,
}: Props) {
  const imageFile = imageExtension.test(file.path);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<DuplicateImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    if (!imageFile) return;
    let active = true;
    const abort = new AbortController();
    duplicatePreview(sessionId, comparisonId, side, abort.signal).then(
      (image) => {
        if (active) setPreview(image);
      },
      (failure: unknown) => {
        if (active) {
          setError(friendlyError(failure));
          onPreviewReady(side, false);
        }
      },
    );
    return () => {
      active = false;
      abort.abort();
    };
  }, [sessionId, comparisonId, side, imageFile, attempt, onPreviewReady]);
  const loading = imageFile && !error && !loaded;
  const details = [
    [t.size, formatSize(file.stamp.size)],
    [t.created, formatDateTime(file.stamp.createdAt)],
    [t.modified, formatDateTime(file.stamp.modifiedAt)],
    ...(preview ? [[t.dimensions, `${preview.width} × ${preview.height} px`]] : []),
  ];
  return (
    <Paper
      variant="outlined"
      onClick={() => {
        if (!busy) onSelect(side);
      }}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? (theme) => `0 0 0 1px ${theme.palette.primary.main}` : undefined,
      }}
    >
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Button
            size="small"
            disabled={busy}
            aria-pressed={selected}
            aria-keyshortcuts={side === 'left' ? '1' : '2'}
            onClick={() => onSelect(side)}
          >
            {side === 'left' ? t.selectLeft : t.selectRight}
          </Button>
          {selected && (
            <Chip size="small" label={t.selectedCopy} color="primary" variant="outlined" />
          )}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h3" noWrap title={file.path} sx={{ flex: 1, minWidth: 0 }}>
            {folderName(file.path)}
          </Typography>
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineRounded />}
            disabled={busy || !canRemove}
            aria-keyshortcuts={selected ? 'Delete' : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(side);
              onRemove(side);
            }}
            sx={{ flexShrink: 0 }}
          >
            {t.remove}
          </Button>
        </Stack>
        <Typography
          variant="caption"
          color="text.secondary"
          title={file.path}
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            mt: 0.5,
          }}
        >
          {file.path}
        </Typography>
      </Box>
      <Box
        sx={{
          height: 'clamp(180px, 32vh, 300px)',
          flexShrink: 0,
          position: 'relative',
          bgcolor: 'action.hover',
          overflow: 'auto',
          display: zoom === null ? 'grid' : 'block',
          gridTemplateRows: zoom === null ? 'minmax(0, 1fr)' : undefined,
          gridTemplateColumns: zoom === null ? 'minmax(0, 1fr)' : undefined,
          placeItems: 'center',
        }}
      >
        {preview && !error && (
          <Box
            component="img"
            src={preview.dataUrl}
            alt={`${t.image} ${folderName(file.path)}`}
            onLoad={() => {
              setLoaded(true);
              onPreviewReady(side, true);
            }}
            onError={() => {
              setError(t.imageError);
              onPreviewReady(side, false);
            }}
            sx={
              zoom === null
                ? {
                    width: '100%',
                    height: '100%',
                    maxHeight: '100%',
                    minHeight: 0,
                    minWidth: 0,
                    objectFit: 'contain',
                    display: 'block',
                  }
                : {
                    width: preview.width * zoom,
                    height: preview.height * zoom,
                    maxWidth: 'none',
                    objectFit: 'contain',
                    display: 'block',
                  }
            }
          />
        )}
        {loading && (
          <Stack
            alignItems="center"
            spacing={1.5}
            sx={{
              position: 'absolute',
              inset: 0,
              justifyContent: 'center',
              bgcolor: 'background.paper',
            }}
          >
            <CircularProgress size={26} />
            <Typography variant="body2" color="text.secondary">
              {t.loadingImage}
            </Typography>
          </Stack>
        )}
        {(!imageFile || error) && (
          <Stack alignItems="center" spacing={1.5} sx={{ p: 2, maxWidth: '100%' }}>
            <ImageOutlined sx={{ fontSize: 44, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary">
              {error ? t.imageError : t.unavailableImage}
            </Typography>
            {error && (
              <Alert severity="warning" sx={{ maxWidth: '100%' }}>
                {error}
              </Alert>
            )}
            {error && (
              <Button
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setPreview(null);
                  setLoaded(false);
                  onPreviewReady(side, false);
                  setAttempt((value) => value + 1);
                }}
              >
                {t.retryImage}
              </Button>
            )}
          </Stack>
        )}
      </Box>
      <Stack
        direction="row"
        justifyContent="center"
        alignItems="center"
        spacing={0.5}
        sx={{ p: 0.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tooltip title={t.zoomOut}>
          <span>
            <IconButton
              aria-label={t.zoomOut}
              disabled={!loaded || !!error || (zoom !== null && zoom <= 0.25)}
              onClick={() => setZoom((value) => Math.max(0.25, (value ?? 1) / 2))}
            >
              <ZoomOutRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Button size="small" disabled={!loaded || !!error} onClick={() => setZoom(null)}>
          {t.fit}
        </Button>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'center' }}>
          {zoom === null ? '—' : `${zoom * 100}%`}
        </Typography>
        <Tooltip title={t.zoomIn}>
          <span>
            <IconButton
              aria-label={t.zoomIn}
              disabled={!loaded || !!error || (zoom !== null && zoom >= 4)}
              onClick={() => setZoom((value) => Math.min(4, (value ?? 0.5) * 2))}
            >
              <ZoomInRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box
        component="dl"
        sx={{
          m: 0,
          p: 2,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 16px',
          flex: 1,
        }}
      >
        {details.map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography component="dd" variant="caption" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
