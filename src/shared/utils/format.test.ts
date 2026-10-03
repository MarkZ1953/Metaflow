import { describe, expect, it } from 'vitest';
import { breadcrumbs, formatSize } from './format';

describe('display helpers', () => {
  it('distinguishes an unknown size from an empty file', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1024)).toBe('1 KB');
  });
  it('builds breadcrumbs inside a Windows drive root', () => {
    expect(breadcrumbs('C:\\Photos\\2026', 'C:\\')).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'Photos', path: 'C:\\Photos' },
      { name: '2026', path: 'C:\\Photos\\2026' },
    ]);
  });
  it('supports POSIX root and nested folder paths', () => {
    expect(breadcrumbs('/home/photos/2026', '/home/photos').at(-1)?.path).toBe('/home/photos/2026');
    expect(breadcrumbs('/home', '/')[1]?.path).toBe('/home');
  });
});
