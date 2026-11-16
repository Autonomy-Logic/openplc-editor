/** The line of `@yowasp/clang`'s `gen/bundle.js` that substitutes a logging, response-wrapping progress callback. */
const ORIGINAL_LINE = 'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)'
/** The same call without the substitute, so a run with no `fetchProgress` compiles each file from its URL. */
const PATCHED_LINE = 'this.#fetchResources(options.fetchProgress)'

/** How many times `part` occurs in `text`. */
const occurrences = (text: string, part: string): number => text.split(part).length - 1

/**
 * Makes the bundled loader fetch and compile its modules unwrapped when a run gives no `fetchProgress`.
 * @param bundleSource The text of `gen/bundle.js` as the package ships it.
 * @returns The same text with the one default progress callback removed.
 * @throws {Error} `The @yowasp/clang loader patch does not apply (found <n>).` when the line is not there exactly once.
 */
export function patchYowaspLoader(bundleSource: string): string {
  const found = occurrences(bundleSource, ORIGINAL_LINE)
  if (found !== 1) throw new Error(`The @yowasp/clang loader patch does not apply (found ${found}).`)
  return bundleSource.replace(ORIGINAL_LINE, PATCHED_LINE)
}

/** Whether a `bundle.js` text carries the patch: the original line absent and the patched line present once. */
export function isYowaspLoaderPatched(bundleSource: string): boolean {
  return occurrences(bundleSource, ORIGINAL_LINE) === 0 && occurrences(bundleSource, PATCHED_LINE) === 1
}
