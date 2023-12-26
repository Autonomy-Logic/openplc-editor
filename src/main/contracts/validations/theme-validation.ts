import { z } from 'zod';

import { CONSTANTS } from '../../../utils';

const {
  theme: { variants },
} = CONSTANTS;

const ThemeSchema = z.string().refine((theme) => Object.values(variants).includes(theme));

export default ThemeSchema;
