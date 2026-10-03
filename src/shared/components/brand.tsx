import { Box, Stack, Typography } from '@mui/material';
import { workspaceMessages } from '../constants/workspace-messages';

export function Brand() {
  return (
    <Stack direction="row" alignItems="center" spacing={1.2}>
      <Box
        component="img"
        src="/metaflow.svg"
        alt=""
        sx={{ width: 30, height: 30, borderRadius: 1 }}
      />
      <Typography sx={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.04em' }}>
        Metaflow
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ alignSelf: 'flex-start', pt: 0.4 }}>
        {workspaceMessages.v}
      </Typography>
    </Stack>
  );
}
