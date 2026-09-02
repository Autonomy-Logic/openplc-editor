import type { EmbeddedFontSet } from '@root/backend/shared/print'

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

/** Decoded once per worker/tab lifetime — each font is ~100-125KB of base64. */
export function getEmbeddedFontSet(): EmbeddedFontSet {
  cached ??= {
    sans: base64ToBytes(NOTO_SANS_REGULAR_BASE64),
    sansBold: base64ToBytes(NOTO_SANS_BOLD_BASE64),
    mono: base64ToBytes(NOTO_SANS_MONO_REGULAR_BASE64),
    monoBold: base64ToBytes(NOTO_SANS_MONO_BOLD_BASE64),
  }
  return cached
}
