import { CONSTANTS } from '@shared/constants';
import { z } from 'zod';

const {
  theme: { variants },
} = CONSTANTS;

export const themeSchema = z
  .string()
  .refine((theme) => Object.values(variants).includes(theme));

export type ThemeProps = z.infer<typeof themeSchema>;
