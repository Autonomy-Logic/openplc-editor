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
  /**
   * The Edge session, when the user has chosen to sign in. Optional because signing
   * in is optional: the editor is fully usable with no account, and an absent key is
   * the normal state rather than a missing value to repair.
   *
   * `refreshToken` holds a base64 `safeStorage` ciphertext, never the raw token. See
   * `backend/editor/edge-account/session-store.ts` for why the access token is
   * deliberately not kept.
   */
  edge_session: z
    .object({
      refreshToken: z.string(),
    })
    .optional(),
})

export { StoreSchema, ThemeSchema }
