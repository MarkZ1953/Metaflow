const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const detailDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const numberFormatter = new Intl.NumberFormat('es-CO');

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: index === 0 ? 0 : 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function formatDate(value: number | null, detailed = false): string {
  if (value === null) return 'No disponible';
  return (detailed ? detailDateFormatter : dateFormatter).format(value);
}

export function formatCount(value: number): string {
  return numberFormatter.format(value);
}

export function formatQuantity(value: number, singular: string, plural: string): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

export function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || path
  );
}

export function breadcrumbs(path: string, root: string): { name: string; path: string }[] {
  const remainder = path.slice(root.length).replace(/^[\\/]+/, '');
  const separator = root.includes('\\') ? '\\' : '/';
  let current = root;
  const crumbs = [{ name: folderName(root), path: root }];
  for (const segment of remainder.split(/[\\/]/).filter(Boolean)) {
    current = `${current.replace(/[\\/]+$/, '')}${separator}${segment}`;
    crumbs.push({ name: segment, path: current });
  }
  return crumbs;
}
export function formatDateTime(value: number | null): string {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  );
}
