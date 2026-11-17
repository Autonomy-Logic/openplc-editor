/**
 * The `hmi` capability: a local display a board drives itself. One schema serves the manifest check and the resolver,
 * so a block the manifest accepts is exactly a block the resolver keeps.
 */
import { z } from 'zod'

import type { HmiPanelCapability } from './types'

/** Default static display-list capacity, in bytes. */
export const HMI_DEFAULT_DISPLAY_LIST_BYTES = 16384

/** Default static glyph cache, in bytes. */
export const HMI_DEFAULT_GLYPH_CACHE_BYTES = 8192

/** Default static band buffer, in bytes. */
export const HMI_DEFAULT_BAND_BYTES = 20480

/** Largest panel width or height, in pixels. */
export const HMI_PANEL_MAX_DIMENSION = 4096

/** Largest integer UI scale. */
export const HMI_PANEL_MAX_DENSITY = 8

/** Smallest static buffer a panel may declare, in bytes. */
export const HMI_PANEL_MIN_BUFFER_BYTES = 1024

/** Largest static buffer a panel may declare, in bytes. */
export const HMI_PANEL_MAX_BUFFER_BYTES = 1048576

const dimension = z.number().int().min(1).max(HMI_PANEL_MAX_DIMENSION)
const bufferBytes = z.number().int().min(HMI_PANEL_MIN_BUFFER_BYTES).max(HMI_PANEL_MAX_BUFFER_BYTES)

/** Message when a band buffer holds less than one RGBA row of a panel `width` pixels wide. */
export function hmiBandBelowRowMessage(bandBytes: number, width: number): string {
  return `The HMI band buffer (bandBytes ${bandBytes}) holds less than one panel row (${width * 4} bytes for a width of ${width})`
}

/**
 * A declared `hmi` block. Unknown keys are refused, so a misspelt size never falls back to its default unnoticed, and
 * so is a band buffer smaller than one RGBA row, with which the panel cannot be drawn.
 */
export const hmiPanelCapabilitySchema = z
  .object({
    width: dimension,
    height: dimension,
    density: z.number().int().min(1).max(HMI_PANEL_MAX_DENSITY),
    touch: z.boolean(),
    colorFormat: z.enum(['rgb565', 'rgb888']),
    displayListBytes: bufferBytes.optional(),
    glyphCacheBytes: bufferBytes.optional(),
    bandBytes: bufferBytes.optional(),
  })
  .strict()
  .superRefine((panel, ctx) => {
    const band = panel.bandBytes ?? HMI_DEFAULT_BAND_BYTES
    if (band < panel.width * 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bandBytes'],
        message: hmiBandBelowRowMessage(band, panel.width),
      })
    }
  })

/** A panel profile with every buffer size filled in. */
export type ResolvedHmiPanel = Required<HmiPanelCapability>

/**
 * The whole panel profile a board declares, its buffer sizes defaulted, or null when the board declares no panel
 * or a block that does not validate.
 */
export function resolveHmiPanel(declared: unknown): ResolvedHmiPanel | null {
  if (declared === undefined || declared === null) return null
  const parsed = hmiPanelCapabilitySchema.safeParse(declared)
  if (!parsed.success) return null
  const panel = parsed.data
  return {
    ...panel,
    displayListBytes: panel.displayListBytes ?? HMI_DEFAULT_DISPLAY_LIST_BYTES,
    glyphCacheBytes: panel.glyphCacheBytes ?? HMI_DEFAULT_GLYPH_CACHE_BYTES,
    bandBytes: panel.bandBytes ?? HMI_DEFAULT_BAND_BYTES,
  }
}
