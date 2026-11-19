import { z } from 'zod'

import type { HmiBuildSources } from '../../ports/hmi-preview-types'
import { hmiSettingsSchema } from './settings'

const sourceFile = z.object({ name: z.string(), source: z.string() })

const plcVariable = z.object({
  path: z.string(),
  type: z.string(),
  initialValue: z.string().optional(),
  constant: z.literal(true).optional(),
  source: z
    .object({
      kind: z.enum(['alarms', 'events', 'summary', 'numbers']),
      lower: z.number().int().optional(),
      upper: z.number().int().optional(),
      element: z.string().optional(),
    })
    .optional(),
})

/** The shape of `HmiBuildSources`, for where it crosses a process boundary. */
export const hmiBuildSourcesSchema = z.object({
  screens: z.array(sourceFile),
  widgets: z.array(sourceFile),
  settings: hmiSettingsSchema,
  plcVariables: z.array(plcVariable),
  plcDeclarations: z.string().optional(),
  projectNames: z.array(z.string()),
})

/** `value` as HmiBuildSources or null; an error message when it is neither. */
export function parseHmiBuildSources(
  value: unknown,
): { ok: true; hmi: HmiBuildSources | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, hmi: null }
  const parsed = hmiBuildSourcesSchema.safeParse(value)
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  return { ok: true, hmi: parsed.data }
}
