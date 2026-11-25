/** When the HMI preview shows a build's progress, and how. */
import type { HmiBuildStep } from '@root/middleware/shared/ports/hmi-preview-types'

/** What the preview's progress shows: the build's step, over the last frame (dimmed) when there is one. */
export interface PreviewProgress {
  step: HmiBuildStep
  dimmed: boolean
}

/** How long an edit waits for its build before the progress shows, so edits that build fast never flash it. */
export const PREVIEW_PROGRESS_DELAY_MS = 300

/**
 * The preview's progress while a build runs that the screen waits for: its first build, in place of the screen, or an
 * edit the running module cannot show, over the last frame dimmed (null otherwise).
 */
export function previewProgress(preview: {
  status: string
  step: HmiBuildStep | null
  built: object | null
  waiting: boolean
}): PreviewProgress | null {
  if (preview.status !== 'building') return null
  if (preview.built === null) return { step: preview.step ?? 'sources', dimmed: false }
  return preview.waiting ? { step: preview.step ?? 'sources', dimmed: true } : null
}
