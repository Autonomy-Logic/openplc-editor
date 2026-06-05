/**
 * Compose the arduino-cli `compile` invocation for a board's hals.json
 * entry.  Single source of truth shared between openplc-editor
 * (handleCompileArduinoProgram) and openplc-web (compiler-adapter) so
 * the simulator + Arduino board flow stays in parity across the two
 * frontends.
 *
 * Pure function — no I/O, no environment access.  Callers are
 * responsible for resolving filesystem paths (avr-libstdcpp include,
 * sketch path, --library directory) and any extra trailing arguments
 * specific to their host (the editor passes its base parameters like
 * `--config-file`; web doesn't).
 */

/** Subset of a hals.json board entry the compile-args composer reads. */
export interface BoardHalsCompileEntry {
  /** Required.  e.g. `arduino:avr:mega`. */
  platform: string
  /** Optional.  e.g. `arduino:avr`.  Used to gate the avr-libstdcpp -I append. */
  core?: string
  c_flags?: readonly string[]
  cxx_flags?: readonly string[]
  ld_flags?: readonly string[]
  /** Translates to `--build-property upload.maximum_data_size=N`. */
  max_data_size?: number
}

export interface BuildArduinoCliCompileArgsOptions {
  /** Full path to the .ino sketch entry. */
  sketchPath: string
  /** Directory passed via `--library` (contains generated.cpp, runtime headers, etc.). */
  libraryPath: string
  /**
   * Filesystem path to the avr-libstdcpp include directory.  Appended
   * as `-I<path>` onto `compiler.cpp.extra_flags` when the board's
   * `core` starts with `arduino:avr`.  Required there because the AVR
   * toolchain doesn't ship a C++ standard library and strucpp-emitted
   * code #includes <cstdint>, etc.
   */
  avrLibStdCppInclude?: string
  /** Adds `--clean` to invalidate arduino-cli's per-file cache. */
  cleanBuild?: boolean
  /**
   * Append `-j 0` (saturate every CPU core).  Defaults to true to
   * match the editor's flow.  Disable for compile-service backends
   * that don't want a single client to pin every core.
   */
  parallel?: boolean
  /** Extra args appended after the sketch path (e.g. `--config-file`). */
  trailingArgs?: readonly string[]
}

/**
 * Builds the full argv for an arduino-cli `compile` invocation
 * against the given hals.json board entry.
 */
export function buildArduinoCliCompileArgs(
  entry: BoardHalsCompileEntry,
  options: BuildArduinoCliCompileArgsOptions,
): string[] {
  const args: string[] = ['compile', '-v']

  if (options.parallel !== false) {
    args.push('-j', '0')
  }

  if (options.cleanBuild) {
    args.push('--clean')
  }

  if (entry.c_flags && entry.c_flags.length > 0) {
    args.push('--build-property', `compiler.c.extra_flags=${entry.c_flags.join(' ')}`)
  }

  if (entry.cxx_flags && entry.cxx_flags.length > 0) {
    const cxxFlags = [...entry.cxx_flags]
    if (entry.core?.startsWith('arduino:avr') && options.avrLibStdCppInclude) {
      cxxFlags.push(`-I${options.avrLibStdCppInclude}`)
    }
    args.push('--build-property', `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`)
  }

  if (entry.ld_flags && entry.ld_flags.length > 0) {
    args.push('--build-property', `compiler.c.elf.extra_flags=${entry.ld_flags.join(' ')}`)
  }

  // `upload.maximum_data_size` is the post-link size check; boards
  // like the simulator that target a stock Arduino platform but
  // emulate more RAM than the canonical SoC override both the linker
  // memory map (via ld_flags) AND this so arduino-cli doesn't reject
  // the binary with "data section exceeds available space".
  if (typeof entry.max_data_size === 'number') {
    args.push('--build-property', `upload.maximum_data_size=${entry.max_data_size}`)
  }

  args.push('--library', options.libraryPath, '--export-binaries', '-b', entry.platform, options.sketchPath)

  if (options.trailingArgs && options.trailingArgs.length > 0) {
    args.push(...options.trailingArgs)
  }

  return args
}
