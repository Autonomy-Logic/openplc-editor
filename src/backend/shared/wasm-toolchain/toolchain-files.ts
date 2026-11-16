/** The files of the `@yowasp/clang` package a clang worker loads, relative to the package root. */
export const WASM_TOOLCHAIN_PACKAGE_FILES: readonly string[] = [
  'gen/bundle.js',
  'gen/llvm-resources.tar',
  'gen/llvm.core.wasm',
  'gen/llvm.core2.wasm',
  'gen/llvm.core3.wasm',
  'gen/llvm.core4.wasm',
]

/**
 * Checks that every path exists.
 * @param paths The files to check, in the order a missing one is reported.
 * @param exists Tells whether one path exists.
 * @param what What the files belong to, as the error names it.
 * @throws {Error} `Missing <what> file: <path>` for the first missing path.
 */
export async function requireFiles(
  paths: readonly string[],
  exists: (path: string) => Promise<boolean>,
  what: string,
): Promise<void> {
  const present = await Promise.all(paths.map((path) => exists(path)))
  const missing = paths.find((_, index) => !present[index])
  if (missing !== undefined) throw new Error(`Missing ${what} file: ${missing}`)
}
