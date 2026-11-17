const ORIGINAL_LINE = 'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)'
const PATCHED_LINE = 'this.#fetchResources(options.fetchProgress)'
const CHANGE_NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'

/** How many times `part` occurs in `text`. */
const occurrences = (text: string, part: string): number => text.split(part).length - 1

/**
 * Makes the bundled loader fetch and compile its modules unwrapped when a run gives no `fetchProgress`: the line
 * `this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)`, which substitutes a logging, response-wrapping
 * progress callback, becomes `this.#fetchResources(options.fetchProgress)`, and a one-line change notice is added on top.
 * @param bundleSource The text of `gen/bundle.js` as the package ships it.
 * @returns The change notice, then the same text with the one default progress callback removed.
 * @throws {Error} `The @yowasp/clang loader patch does not apply (found <n>).` when the line is not there exactly once.
 */
export function patchYowaspLoader(bundleSource: string): string {
  const found = occurrences(bundleSource, ORIGINAL_LINE)
  if (found !== 1) throw new Error(`The @yowasp/clang loader patch does not apply (found ${found}).`)
  return CHANGE_NOTICE + bundleSource.replace(ORIGINAL_LINE, PATCHED_LINE)
}

/**
 * Whether a `bundle.js` text carries the patch: it starts with the change notice, the original
 * `this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)` is absent and the patched call is present once.
 */
export function isYowaspLoaderPatched(bundleSource: string): boolean {
  return (
    bundleSource.startsWith(CHANGE_NOTICE) &&
    occurrences(bundleSource, ORIGINAL_LINE) === 0 &&
    occurrences(bundleSource, PATCHED_LINE) === 1
  )
}
