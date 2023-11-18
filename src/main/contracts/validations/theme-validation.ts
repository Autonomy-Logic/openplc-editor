import { z } from 'zod';
import { constants } from '../../../shared/data';
const {
  theme: { variants },
} = constants;

export const ThemeSchema = z
  .string()
  .refine((theme) => Object.values(variants).includes(theme));
