import { IconButton, Tooltip } from '@mui/material';
import type { IconButtonProps } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';

interface ActionButtonProps extends IconButtonProps {
  label: string;
  icon: SvgIconComponent;
}
export function ActionButton({ label, icon: Icon, ...props }: ActionButtonProps) {
  return (
    <Tooltip title={label}>
      <span style={{ display: 'inline-flex' }}>
        <IconButton aria-label={label} size="small" {...props}>
          <Icon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}
