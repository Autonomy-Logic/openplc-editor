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
const thirdPartyReadme = readFileSync(join(repo, 'third-party-licenses', 'yowasp-clang', 'README.md'), 'utf8')

const ORIGINAL = 'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)'
const PATCHED = 'this.#fetchResources(options.fetchProgress)'
const NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'

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

  it('adds the change notice and replaces the one default progress callback, changing nothing else', () => {
    const patched = patchYowaspLoader(installedBundle)

    expect(patched).toBe(NOTICE + installedBundle.replace(ORIGINAL, PATCHED))
    expect(occurrences(patched, PATCHED)).toBe(1)
    expect(patched).not.toContain('?? defaultFetchProgress')
  })

  it('makes the change notice the first line of the patched bundle.js', () => {
    const patched = patchYowaspLoader(installedBundle)

    expect(patched.slice(0, patched.indexOf('\n') + 1)).toBe(NOTICE)
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
  it('is true for a text starting with the notice, with the patched line once and no original line', () => {
    expect(isYowaspLoaderPatched(NOTICE + loaderWith(1).replace(ORIGINAL, PATCHED))).toBe(true)
  })

  it('is true for what patchYowaspLoader returns on a loader-shaped text', () => {
    expect(isYowaspLoaderPatched(patchYowaspLoader(loaderWith(1)))).toBe(true)
  })

  it('is false for a text with the patched line once but no change notice', () => {
    expect(isYowaspLoaderPatched(loaderWith(1).replace(ORIGINAL, PATCHED))).toBe(false)
  })

  it('is false for a text whose change notice is not its first line', () => {
    expect(isYowaspLoaderPatched(`export {}\n${NOTICE}${loaderWith(1).replace(ORIGINAL, PATCHED)}`)).toBe(false)
  })

  it.each([
    ['the original line only', loaderWith(1)],
    ['neither line', loaderWith(0)],
    ['the patched line twice', `${PATCHED}\n${PATCHED}`],
    ['both lines', `${ORIGINAL}\n${PATCHED}`],
    ['the notice and the original line only', NOTICE + loaderWith(1)],
    ['the notice and the patched line twice', `${NOTICE}${PATCHED}\n${PATCHED}`],
  ])('is false for a text with %s', (_label, text) => {
    expect(isYowaspLoaderPatched(text)).toBe(false)
  })
})

describe('the third-party README of @yowasp/clang', () => {
  it('names the patched line of gen/bundle.js and the licence section the change notice meets', () => {
    expect(thirdPartyReadme).toContain(ORIGINAL)
    expect(thirdPartyReadme).toContain(PATCHED)
    expect(thirdPartyReadme).toContain('Apache License 2.0, section 4(b)')
  })
})
