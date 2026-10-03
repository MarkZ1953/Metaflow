import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import { invalidateMediaPreview, mediaPreview } from '../services/media-preview-cache';
import { classificationError } from '../services/classification-error';
import type { MediaEntry, MediaPreview as Preview } from '../services/classification-service';
import { classificationMessages as t } from '../../../shared/constants/classification-messages';
interface Props {
  sessionId: string;
  entry: MediaEntry;
  expanded?: boolean;
  onExpand?: () => void;
}
function seconds(value: number): string {
  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
export function MediaPreview({ sessionId, entry, expanded = false, onExpand }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(expanded);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    if (expanded || visible || !holder.current) return;
    const observer = new IntersectionObserver(
      ([item]) => {
        if (item?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [expanded, visible]);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    let active = true;
    mediaPreview(sessionId, entry.id, abort.signal).then(
      (value) => {
        if (active) setPreview(value);
      },
      (failure: unknown) => {
        if (active) setError(classificationError(failure));
      },
    );
    return () => {
      active = false;
      abort.abort();
    };
  }, [sessionId, entry.id, visible, attempt]);
  const current = preview?.frames[frame] ?? preview?.frames[0];
  const Icon = entry.kind === 'video' ? VideocamOutlined : ImageOutlined;
  return (
    <Box ref={holder} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          height: expanded ? 'clamp(220px, 48vh, 540px)' : 168,
          bgcolor: 'action.hover',
          position: 'relative',
          overflow: 'auto',
          display: zoom === null ? 'grid' : 'block',
          placeItems: 'center',
          gridTemplateRows: 'minmax(0,1fr)',
          gridTemplateColumns: 'minmax(0,1fr)',
        }}
      >
        {current && !error ? (
          <Box
            component="img"
            src={current.dataUrl}
            alt={entry.name}
            onError={() => setError(t.previewError)}
            onDoubleClick={onExpand}
            sx={
              zoom === null
                ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block' }
                : {
                    width: Math.min(current.width, 4096) * zoom,
                    height:
                      ((Math.min(current.width, 4096) * current.height) / current.width) * zoom,
                    maxWidth: 'none',
                    display: 'block',
                  }
            }
          />
        ) : (
          <Stack
            alignItems="center"
            spacing={1}
            sx={{ p: 2, maxWidth: '100%', textAlign: 'center' }}
          >
            {visible && !error ? (
              <CircularProgress size={24} />
            ) : (
              <Icon sx={{ fontSize: 36, color: 'text.disabled' }} />
            )}
            {expanded && (
              <Typography variant="body2" color="text.secondary">
                {error ?? t.loadingPreview}
              </Typography>
            )}
            {error && (
              <Button
                size="small"
                onClick={() => {
                  invalidateMediaPreview(sessionId, entry.id);
                  setError(null);
                  setPreview(null);
                  setAttempt((value) => value + 1);
                }}
              >
                {t.retryPreview}
              </Button>
            )}
          </Stack>
        )}
        {!expanded && onExpand && (
          <Button
            size="small"
            variant="contained"
            color="inherit"
            onClick={onExpand}
            sx={{
              position: 'absolute',
              right: 6,
              bottom: 6,
              minWidth: 0,
              bgcolor: 'background.paper',
              opacity: 0.95,
            }}
          >
            {t.expand}
          </Button>
        )}
      </Box>
      {expanded && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="center"
            spacing={1}
            sx={{ p: 0.5 }}
          >
            <Tooltip title={t.zoomOut}>
              <span>
                <IconButton
                  disabled={!current || !!error || (zoom !== null && zoom <= 0.25)}
                  aria-label={t.zoomOut}
                  onClick={() => setZoom((value) => Math.max(0.25, (value ?? 1) / 2))}
                >
                  <ZoomOutRounded />
                </IconButton>
              </span>
            </Tooltip>
            <Button size="small" disabled={!current || !!error} onClick={() => setZoom(null)}>
              {t.fit}
            </Button>
            <Typography variant="caption">{zoom === null ? '—' : `${zoom * 100}%`}</Typography>
            <Tooltip title={t.zoomIn}>
              <span>
                <IconButton
                  disabled={!current || !!error || (zoom !== null && zoom >= 4)}
                  aria-label={t.zoomIn}
                  onClick={() => setZoom((value) => Math.min(4, (value ?? 0.5) * 2))}
                >
                  <ZoomInRounded />
                </IconButton>
              </span>
            </Tooltip>
            {current && (
              <Typography variant="caption" color="text.secondary">
                {current.width} × {current.height} px
              </Typography>
            )}
          </Stack>
          {entry.kind === 'video' && preview && (
            <Stack spacing={1} sx={{ px: 2, pb: 2 }}>
              <Typography variant="subtitle2">{t.frames}</Typography>
              <Stack direction="row" spacing={1}>
                {preview.frames.map((value, index) => (
                  <Button
                    key={index}
                    variant={index === frame ? 'outlined' : 'text'}
                    onClick={() => {
                      setFrame(index);
                      setZoom(null);
                    }}
                    sx={{ flex: 1, flexDirection: 'column', minWidth: 0, gap: 0.5 }}
                  >
                    <Box
                      component="img"
                      src={value.dataUrl}
                      alt={`${entry.name} · ${index + 1}`}
                      sx={{ width: '100%', maxHeight: 80, objectFit: 'contain' }}
                    />
                    {value.atSeconds === null ? `${index + 1}` : seconds(value.atSeconds)}
                  </Button>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t.framesHint}
              </Typography>
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
