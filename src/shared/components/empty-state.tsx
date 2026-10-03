import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { SvgIconComponent } from '@mui/icons-material';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: SvgIconComponent;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ height: '100%', minHeight: 250, px: 3, py: 4, textAlign: 'center' }}
    >
      <Box
        sx={{
          width: 58,
          height: 58,
          borderRadius: 2,
          bgcolor: 'action.hover',
          display: 'grid',
          placeItems: 'center',
          color: 'text.secondary',
          mb: 0.5,
        }}
      >
        <Icon sx={{ fontSize: 28 }} />
      </Box>
      <Typography variant="h3">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 360 }}>
        {description}
      </Typography>
      {action}
    </Stack>
  );
}
