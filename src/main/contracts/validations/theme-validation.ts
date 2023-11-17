import { z } from 'zod';
import { CONSTANTS } from '../../../shared/utils';
const {
  theme: { variants },
} = CONSTANTS;

export const ThemeSchema = z
  .string()
  .refine((theme) => Object.values(variants).includes(theme));
