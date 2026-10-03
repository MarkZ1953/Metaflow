import { z } from 'zod';

export const filterSchema = z.object({
  extension: z
    .string()
    .trim()
    .refine(
      (value) => /^\.?[a-zA-Z0-9]*$/.test(value),
      'Escribe una extensión, por ejemplo pdf o jpg.',
    )
    .transform((value) => value.replace(/^\./, '').toLowerCase()),
  minimumSize: z.enum(['all', '1048576', '10485760', '104857600', '1073741824']),
});
export type FilterValues = z.input<typeof filterSchema>;
