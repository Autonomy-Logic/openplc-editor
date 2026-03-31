import { CONSTANTS } from '@root/frontend/utils/app-constants'
import { z } from 'zod'

const {
  theme: { variants },
} = CONSTANTS as { theme: { variants: Record<string, string> } }

const ThemeSchema = z.string().refine((theme) => Object.values(variants).includes(theme))

export default ThemeSchema
