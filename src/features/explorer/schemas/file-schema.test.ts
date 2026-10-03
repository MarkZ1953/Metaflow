import { describe, expect, it } from 'vitest';
import { directoryListingSchema, fileEntrySchema } from './file-schema';
import { filterSchema } from './filter-schema';
import { demoService } from '../services/demo-service';

const folder = await demoService.pickFolder();
const listing = await demoService.readDirectory(folder!.path);
describe('IPC and form boundaries', () => {
  it('accepts the complete typed directory contract', () => {
    expect(directoryListingSchema.parse(listing)).toEqual(listing);
  });
  it('rejects negative, unsafe or wrongly typed byte sizes', () => {
    for (const size of [-1, Number.MAX_SAFE_INTEGER + 1, '2048']) {
      expect(fileEntrySchema.safeParse({ ...listing.entries[2], size }).success).toBe(false);
    }
  });
  it('rejects unknown categories and missing entry paths', () => {
    expect(
      fileEntrySchema.safeParse({ ...listing.entries[2], category: 'untrusted' }).success,
    ).toBe(false);
    expect(fileEntrySchema.safeParse({ ...listing.entries[2], path: '' }).success).toBe(false);
  });
  it('normalizes a valid extension and rejects multi-extension expressions', () => {
    expect(filterSchema.parse({ extension: ' .PDF ', minimumSize: 'all' }).extension).toBe('pdf');
    expect(filterSchema.safeParse({ extension: 'pdf,jpg', minimumSize: 'all' }).success).toBe(
      false,
    );
  });
});
