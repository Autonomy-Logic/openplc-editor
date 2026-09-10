/**
 * Real, valid embeddable font bytes for tests that exercise pdf-lib's actual
 * font-embedding path (`createPdfLibBackend`, `renderProjectToPdf`) — a
 * corrupt/fake buffer makes `doc.embedFont` reject, so these can't be
 * fabricated. Duplicated from `middleware/adapters/web/services/pdf-export/
 * fonts/` rather than imported from there: this test lives in `backend/
 * shared/`, which must stay byte-identical with openplc-editor, and each
 * repo's adapter fonts live under a different per-repo path (Vite/webpack
 * asset pipelines differ — see that directory's own note). Same reasoning as
 * the production duplication, one level further in.
 */

import type { EmbeddedFontSet } from '../../types'
import { NOTO_SANS_BOLD_BASE64 } from './noto-sans-bold'
import { NOTO_SANS_MONO_BOLD_BASE64 } from './noto-sans-mono-bold'
import { NOTO_SANS_MONO_REGULAR_BASE64 } from './noto-sans-mono-regular'
import { NOTO_SANS_REGULAR_BASE64 } from './noto-sans-regular'

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

let cached: EmbeddedFontSet | null = null

export function getTestFontSet(): EmbeddedFontSet {
  cached ??= {
    sans: base64ToBytes(NOTO_SANS_REGULAR_BASE64),
    sansBold: base64ToBytes(NOTO_SANS_BOLD_BASE64),
    mono: base64ToBytes(NOTO_SANS_MONO_REGULAR_BASE64),
    monoBold: base64ToBytes(NOTO_SANS_MONO_BOLD_BASE64),
  }
  return cached
}
