/**
 * Compares the decoded JetBrains Mono faces with the bundled TTF files.
 * @jest-environment node
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getEmbeddedFontSet } from '../embedded-font-set'

/** The SHA-256 of a byte array, in lowercase hex. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const jetbrainsMonoDir = join(__dirname, '..', '..', '..', '..', '..', 'frontend', 'assets', 'fonts', 'jetbrains-mono')

describe('getEmbeddedFontSet', () => {
  it('decodes all six embedded fonts to non-empty byte arrays', () => {
    const fonts = getEmbeddedFontSet()

    expect(fonts.sans.length).toBeGreaterThan(0)
    expect(fonts.sansBold.length).toBeGreaterThan(0)
    expect(fonts.mono.length).toBeGreaterThan(0)
    expect(fonts.monoBold.length).toBeGreaterThan(0)
    expect(fonts.ldMono.length).toBeGreaterThan(0)
    expect(fonts.ldMonoSemibold.length).toBeGreaterThan(0)
  })

  it.each([
    ['ldMono', 'JetBrainsMono-Regular.ttf'],
    ['ldMonoSemibold', 'JetBrainsMono-SemiBold.ttf'],
  ] as const)('decodes %s to the bytes of %s', (key, file) => {
    const decoded = getEmbeddedFontSet()[key]
    const onDisk = new Uint8Array(readFileSync(join(jetbrainsMonoDir, file)))
    expect(decoded.length).toBe(onDisk.length)
    expect(sha256Hex(decoded)).toBe(sha256Hex(onDisk))
  })

  it('caches the decoded set across calls', () => {
    expect(getEmbeddedFontSet()).toBe(getEmbeddedFontSet())
  })
})
