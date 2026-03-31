import { z } from 'zod'

import { CONSTANTS } from '../../../utils'

const {
  theme: { variants },
} = CONSTANTS as { theme: { variants: Record<string, string> } }

const ThemeSchema = z.string().refine((theme) => Object.values(variants).includes(theme))

export default ThemeSchema
