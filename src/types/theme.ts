import { z } from 'zod';
import { CONSTANTS } from '../constants';

const {
  theme: { variants },
} = CONSTANTS;
export const ThemeSchema = z
  .string()
  .refine((theme) => Object.values(variants).includes(theme));

export type ThemeProps = z.infer<typeof ThemeSchema>;
