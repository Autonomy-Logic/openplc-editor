/**
 * Reads the installed `@yowasp/clang` package from the repository's node_modules, so an upgrade that drops or moves
 * the patched line fails here in both repositories.
 * @jest-environment node
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from '@jest/globals'

import { isYowaspLoaderPatched, patchYowaspLoader } from '../yowasp-loader-patch'

const repo = join(__dirname, '..', '..', '..', '..', '..')
const installedBundle = readFileSync(join(repo, 'node_modules', '@yowasp', 'clang', 'gen', 'bundle.js'), 'utf8')

const ORIGINAL = 'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)'
const PATCHED = 'this.#fetchResources(options.fetchProgress)'

const occurrences = (text: string, part: string): number => text.split(part).length - 1

/** A loader-shaped text holding the original line `times` times. */
const loaderWith = (times: number): string =>
  ['export class Application {', ...Array.from({ length: times }, () => `  run() { return ${ORIGINAL} }`), '}'].join(
    '\n',
  )

describe('patchYowaspLoader on the installed @yowasp/clang', () => {
  it('finds the line it replaces exactly once in the installed bundle.js', () => {
    expect(occurrences(installedBundle, ORIGINAL)).toBe(1)
  })

  it('replaces the one default progress callback and changes nothing else', () => {
    const patched = patchYowaspLoader(installedBundle)

    expect(patched).toBe(installedBundle.replace(ORIGINAL, PATCHED))
    expect(occurrences(patched, PATCHED)).toBe(1)
    expect(patched).not.toContain('?? defaultFetchProgress')
  })

  it('marks the patched text as patched and the installed text as not patched', () => {
    expect(isYowaspLoaderPatched(patchYowaspLoader(installedBundle))).toBe(true)
    expect(isYowaspLoaderPatched(installedBundle)).toBe(false)
  })
})

describe('patchYowaspLoader on a loader it does not fit', () => {
  it('throws when the line is absent', () => {
    expect(() => patchYowaspLoader(loaderWith(0))).toThrow('The @yowasp/clang loader patch does not apply (found 0).')
  })

  it('throws when the line appears twice', () => {
    expect(() => patchYowaspLoader(loaderWith(2))).toThrow('The @yowasp/clang loader patch does not apply (found 2).')
  })

  it('throws on a loader that is already patched', () => {
    const patched = patchYowaspLoader(loaderWith(1))

    expect(() => patchYowaspLoader(patched)).toThrow('The @yowasp/clang loader patch does not apply (found 0).')
  })
})

describe('isYowaspLoaderPatched', () => {
  it('is true for a text with the patched line once and no original line', () => {
    expect(isYowaspLoaderPatched(loaderWith(1).replace(ORIGINAL, PATCHED))).toBe(true)
  })

  it.each([
    ['the original line only', loaderWith(1)],
    ['neither line', loaderWith(0)],
    ['the patched line twice', `${PATCHED}\n${PATCHED}`],
    ['both lines', `${ORIGINAL}\n${PATCHED}`],
  ])('is false for a text with %s', (_label, text) => {
    expect(isYowaspLoaderPatched(text)).toBe(false)
  })
})
