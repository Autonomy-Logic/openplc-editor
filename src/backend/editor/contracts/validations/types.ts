import { CONSTANTS } from '@root/backend/shared/utils/app-constants/types'
import z from 'zod'

const {
  theme: { variants },
} = CONSTANTS as { theme: { variants: Record<string, string> } }

const ThemeSchema = z.string().refine((theme) => Object.values(variants).includes(theme))

const StoreSchema = z.object({
  last_projects: z.array(z.string()),
  theme: z.string(),
  window: z.object({
    bounds: z.object({
      width: z.number(),
      height: z.number(),
      x: z.number(),
      y: z.number(),
    }),
  }),
  // Absent key is the signed-out state. `refreshToken` is a base64 `safeStorage` ciphertext, never the raw token.
  edge_session: z
    .object({
      refreshToken: z.string(),
    })
    .optional(),
})

export { StoreSchema, ThemeSchema }
