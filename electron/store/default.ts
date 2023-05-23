import { z } from 'zod';

export const defaultStoreSchema = z.object({
  theme: z.string(),
  toolbar: z.object({
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
  }),
  window: z.object({
    bounds: z
      .object({
        width: z.number(),
        height: z.number(),
        x: z.number(),
        y: z.number(),
      })
      .optional(),
  }),
});

export type DefaultStoreProps = z.infer<typeof defaultStoreSchema>;

export const getDefaultStore = (): DefaultStoreProps => {
  return {
    theme: 'light',
    toolbar: {
      position: {
        x: 0,
        y: 0,
      },
    },
    window: {},
  };
};
