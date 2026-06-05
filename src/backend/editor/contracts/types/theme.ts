import { z } from 'zod'

import { ThemeSchema } from '../validations'

export type TThemeType = z.infer<typeof ThemeSchema>

export { ThemeSchema }
