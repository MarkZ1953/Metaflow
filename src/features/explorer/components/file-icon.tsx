import { Box } from '@mui/material';
import FolderRounded from '@mui/icons-material/FolderRounded';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import AudioFileOutlined from '@mui/icons-material/AudioFileOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import SlideshowOutlined from '@mui/icons-material/SlideshowOutlined';
import FolderZipOutlined from '@mui/icons-material/FolderZipOutlined';
import DataObjectRounded from '@mui/icons-material/DataObjectRounded';
import AppsRounded from '@mui/icons-material/AppsRounded';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import LinkRounded from '@mui/icons-material/LinkRounded';
import type { FileEntry, Category } from '../types/explorer-types';

const icons = {
  folder: FolderRounded,
  image: ImageOutlined,
  video: MovieOutlined,
  audio: AudioFileOutlined,
  document: DescriptionOutlined,
  spreadsheet: TableChartOutlined,
  presentation: SlideshowOutlined,
  archive: FolderZipOutlined,
  code: DataObjectRounded,
  executable: AppsRounded,
  other: InsertDriveFileOutlined,
};
const colors: Record<Category, string> = {
  folder: 'warning.main',
  image: 'secondary.main',
  video: 'info.main',
  audio: 'success.main',
  document: 'info.main',
  spreadsheet: 'success.main',
  presentation: 'warning.main',
  archive: 'warning.main',
  code: 'text.secondary',
  executable: 'text.secondary',
  other: 'text.secondary',
};

export function FileIcon({
  entry,
  large = false,
}: {
  entry: Pick<FileEntry, 'category' | 'kind'>;
  large?: boolean;
}) {
  const Icon = entry.kind === 'symlink' ? LinkRounded : icons[entry.category];
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        color: colors[entry.category],
        width: large ? 76 : 32,
        height: large ? 76 : 32,
        flexShrink: 0,
        borderRadius: large ? 2.5 : 1,
        bgcolor: large ? 'action.hover' : 'transparent',
      }}
    >
      <Icon sx={{ fontSize: large ? 39 : 21 }} />
    </Box>
  );
}
