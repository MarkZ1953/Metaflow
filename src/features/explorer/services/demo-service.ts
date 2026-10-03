import type { DirectoryListing, FileEntry, Category } from '../types/explorer-types';
import type { ExplorerService } from './explorer-service';

// Development-only fixtures. Explicitly opened as a demonstration; never presented as real files.
const root = 'C:\\Demo\\Metaflow';
const date = new Date('2026-10-02T10:00:00-05:00').getTime();
const mimeTypes: Partial<Record<Category, string>> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  document: 'application/pdf',
  audio: 'audio/mpeg',
  code: 'text/plain',
  archive: 'application/zip',
};

function entry(name: string, category: Category, size: number | null, parent = root): FileEntry {
  const isFolder = category === 'folder';
  return {
    path: `${parent}\\${name}`,
    relativePath: `${parent}\\${name}`.slice(root.length + 1),
    name,
    category,
    kind: isFolder ? 'directory' : 'file',
    size,
    extension: isFolder ? '' : (name.split('.').at(-1)?.toLowerCase() ?? ''),
    mimeType: mimeTypes[category] ?? null,
    typeSource: 'extension',
    createdAt: date - 86400000 * 12,
    modifiedAt: date,
    accessedAt: null,
    hidden: name.startsWith('.'),
    readonly: false,
  };
}

const projects = `${root}\\Proyectos`;
const photos = `${root}\\Fotografías`;
const listings: Record<string, FileEntry[]> = {
  [root]: [
    entry('Proyectos', 'folder', null),
    entry('Fotografías', 'folder', null),
    entry('Presentación de marca.pdf', 'document', 2841950),
    entry('Montañas al amanecer.jpg', 'image', 6248910),
    entry('Notas de investigación.md', 'document', 14280),
    entry('Entrevista — episodio 04.mp3', 'audio', 38482100),
    entry('Recorrido por el estudio.mp4', 'video', 246882000),
    entry('Recursos del proyecto.zip', 'archive', 72882100),
    entry('design-tokens.json', 'code', 4820),
    entry('.config', 'other', 128),
  ],
  [projects]: [
    entry('Metaflow — brief.pdf', 'document', 812040, projects),
    entry('readme.md', 'document', 4280, projects),
  ],
  [photos]: [
    entry('Bogotá.jpg', 'image', 4859210, photos),
    entry('Costa.jpg', 'image', 7420190, photos),
  ],
};

export const demoService: ExplorerService = {
  async pickFolder() {
    return { path: root, name: 'Metaflow · demo' };
  },
  async readDirectory(path) {
    const entries = listings[path];
    if (!entries) throw { code: 'FILE_NOT_FOUND' };
    return {
      path,
      rootPath: root,
      parentPath: path === root ? null : root,
      entries,
      unreadableCount: 0,
      scannedAt: date,
    } satisfies DirectoryListing;
  },
  async forgetFolder() {
    /* Virtual fixtures have no filesystem access to revoke. */
  },
};
