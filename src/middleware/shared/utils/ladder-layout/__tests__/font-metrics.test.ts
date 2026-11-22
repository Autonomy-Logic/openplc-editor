/**
 * Reads the bundled JetBrains Mono faces from the repository.
 * @jest-environment node
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import fontkit from '@pdf-lib/fontkit'

import { JETBRAINS_MONO_REGULAR_BASE64 } from '../../../../../backend/shared/print/fonts/jetbrains-mono-regular'
import { JETBRAINS_MONO_SEMIBOLD_BASE64 } from '../../../../../backend/shared/print/fonts/jetbrains-mono-semibold'
import { JETBRAINS_MONO_ADVANCE_EM } from '../measure'

const fontDir = join(__dirname, '..', '..', '..', '..', '..', 'frontend', 'assets', 'fonts', 'jetbrains-mono')

const FACES = [
  { file: 'JetBrainsMono-Regular.ttf', base64: (): string => JETBRAINS_MONO_REGULAR_BASE64 },
  { file: 'JetBrainsMono-SemiBold.ttf', base64: (): string => JETBRAINS_MONO_SEMIBOLD_BASE64 },
] as const

/** The bytes of a bundled TTF face. */
function faceBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fontDir, file)))
}

/** The SHA-256 of a byte array, in lowercase hex. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('JetBrains Mono advance', () => {
  it.each(FACES)('equals the advance of the glyph 0 over unitsPerEm in $file', ({ file }) => {
    const font = fontkit.create(faceBytes(file))
    expect(JETBRAINS_MONO_ADVANCE_EM).toBe(font.glyphForCodePoint(0x30).advanceWidth / font.unitsPerEm)
  })
})

describe('JetBrains Mono print modules', () => {
  it.each(FACES)('decode to the bytes of $file', ({ file, base64 }) => {
    const decoded = Uint8Array.from(atob(base64()), (char) => char.charCodeAt(0))
    const onDisk = faceBytes(file)
    expect(decoded.length).toBe(onDisk.length)
    expect(sha256Hex(decoded)).toBe(sha256Hex(onDisk))
  })
})

describe('JetBrains Mono README', () => {
  it.each(FACES)('records the SHA-256 of $file', ({ file }) => {
    const sha256 = sha256Hex(faceBytes(file))
    const readme = readFileSync(join(fontDir, 'README.md'), 'utf-8')
    expect(readme.toLowerCase()).toContain(sha256)
  })
})
