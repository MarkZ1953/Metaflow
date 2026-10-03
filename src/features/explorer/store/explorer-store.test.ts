import { describe, expect, it, vi } from 'vitest';
import { createExplorerStore } from './explorer-store';
import { demoService } from '../services/demo-service';
import type { ExplorerService } from '../services/explorer-service';
import type { DirectoryListing } from '../types/explorer-types';

const root = (await demoService.pickFolder())!;
const listing = await demoService.readDirectory(root.path);
const childPath = `${root.path}\\Proyectos`;

describe('explorer navigation', () => {
  it('clears multiple selection on navigation and ignores reads after root removal', async () => {
    let resolveRead: ((listing: DirectoryListing) => void) | undefined;
    const pending = new Promise<DirectoryListing>((resolve) => {
      resolveRead = resolve;
    });
    const store = createExplorerStore({
      ...demoService,
      readDirectory: vi.fn().mockResolvedValueOnce(listing).mockReturnValueOnce(pending),
    });
    await store.getState().navigate(root.path);
    store.getState().selectPaths(listing.entries.slice(0, 2).map((e) => e.path));
    expect(store.getState().selectedPaths).toHaveLength(2);
    const read = store.getState().navigate(childPath);
    store.getState().resetNavigation();
    resolveRead?.(listing);
    await read;
    expect(store.getState().listing).toBeNull();
    expect(store.getState().selectedPaths).toEqual([]);
  });
  it('opens only a picked folder and treats picker cancellation as a no-op', async () => {
    const pickFolder = vi.fn().mockResolvedValueOnce(root).mockResolvedValueOnce(null);
    const service = { ...demoService, pickFolder };
    const store = createExplorerStore(service);
    await store.getState().pickFolder();
    expect(store.getState().listing?.path).toBe(root.path);
    await store.getState().pickFolder();
    expect(store.getState().folders).toEqual([root]);
    expect(store.getState().picking).toBe(false);
  });
  it('supports back, forward, parent and branches after going back', async () => {
    const store = createExplorerStore(demoService);
    await store.getState().pickFolder();
    await store.getState().navigate(childPath);
    await store.getState().back();
    expect(store.getState().listing?.path).toBe(root.path);
    await store.getState().forward();
    expect(store.getState().listing?.path).toBe(childPath);
    await store.getState().up();
    expect(store.getState().listing?.path).toBe(root.path);
    await store.getState().back();
    await store.getState().navigate(`${root.path}\\Fotografías`);
    expect(store.getState().history.at(-1)).toBe(`${root.path}\\Fotografías`);
    expect(store.getState().historyIndex).toBe(store.getState().history.length - 1);
  });
  it('keeps the last successful listing and history when a read fails', async () => {
    const store = createExplorerStore(demoService);
    await store.getState().pickFolder();
    await store.getState().navigate('missing');
    expect(store.getState().status).toBe('error');
    expect(store.getState().listing?.path).toBe(root.path);
    expect(store.getState().history).toEqual([root.path]);
    expect(store.getState().error).toContain('ya no existe');
  });
  it('discards stale asynchronous reads', async () => {
    let resolveSlow: ((value: DirectoryListing) => void) | undefined;
    const slow = new Promise<DirectoryListing>((resolve) => {
      resolveSlow = resolve;
    });
    const service: ExplorerService = {
      ...demoService,
      readDirectory: (path) => (path === 'slow' ? slow : demoService.readDirectory(path)),
    };
    const store = createExplorerStore(service);
    const firstRead = store.getState().navigate('slow');
    await store.getState().navigate(childPath);
    resolveSlow?.(listing);
    await firstRead;
    expect(store.getState().listing?.path).toBe(childPath);
  });
  it('does not append history when refreshing and retains a valid selection', async () => {
    const store = createExplorerStore(demoService);
    await store.getState().pickFolder();
    const entry = store.getState().listing!.entries[2]!;
    store.getState().select(entry);
    await store.getState().refresh();
    expect(store.getState().history).toEqual([root.path]);
    expect(store.getState().selected?.path).toBe(entry.path);
  });
  it('revokes the native grant before removing a folder from the interface', async () => {
    const forgetFolder = vi.fn().mockResolvedValue(undefined);
    const store = createExplorerStore({ ...demoService, forgetFolder });
    await store.getState().pickFolder();
    await store.getState().forgetFolder(root.path);
    expect(forgetFolder).toHaveBeenCalledWith(root.path);
    expect(store.getState().folders).toEqual([]);
    expect(store.getState().listing).toBeNull();
  });
  it('resets local query filters when opening another directory', async () => {
    const store = createExplorerStore(demoService);
    await store.getState().pickFolder();
    store.getState().setQuery('pdf');
    store.getState().setFilters('pdf', 1024);
    await store.getState().navigate(childPath);
    expect(store.getState().query).toBe('');
    expect(store.getState().extension).toBe('');
    expect(store.getState().minimumSize).toBeNull();
  });
});
