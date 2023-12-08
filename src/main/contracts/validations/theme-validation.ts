import { z } from 'zod';

import { CONSTANTS } from '../../../utils';

const {
  theme: { variants },
} = CONSTANTS;
// eslint-disable-next-line import/prefer-default-export
export const ThemeSchema = z
  .string()
  .refine((theme) => Object.values(variants).includes(theme));
