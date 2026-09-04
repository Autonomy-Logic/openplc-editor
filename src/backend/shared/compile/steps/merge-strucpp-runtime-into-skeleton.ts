/**
 * Re-key the strucpp runtime headers from their v4-bundle layout
 * (`strucpp_runtime/include/<filename>`) into the flat `src/<filename>`
 * layout the Arduino-cli firmware build expects.
 *
 * Both platforms used to do the same inline rewrite at the entry to
 * `compileProgram` (editor: against bytes loaded from disk; web:
 * against bytes loaded via Vite's `import.meta.glob`).  The merge
 * itself is pure key transformation — pulling it into shared lets a
 * future tweak (e.g. a new strucpp header set) update both repos at
 * once.
 *
 * For the runtime-v4 target the headers stay at their canonical
 * `strucpp_runtime/include/` layout because `composeRuntimeV4Bundle`
 * forwards them verbatim into the upload zip — there's no skeleton
 * merge to do.  Callers branch on `isRuntimeV4` before invoking this
 * helper.
 *
 * Pure: no I/O.  Input bytes are platform-loaded by the caller; output
 * is a new merged file map the pipeline consumes.
 */

export interface MergeStrucppRuntimeArgs {
  /** Arduino-cli firmware skeleton — bundled `Baremetal.ino`,
   *  arduino HAL headers, etc.  Keys are paths relative to the
   *  project's build directory (e.g.
   *  `examples/Baremetal/Baremetal.ino`, `src/openplc.h`). */
  firmwareSkeleton: Record<string, string>
  /** Strucpp runtime headers keyed at `strucpp_runtime/include/<filename>`
   *  — same layout the v4 bundle composer feeds out.  This helper
   *  re-keys each entry to `src/<filename>` so arduino-cli's
   *  `--library src` pass picks them up. */
  strucppRuntimeHeaders: Record<string, string>
  /** Optional board-specific HAL adapter (`hardwareInit`,
   *  `updateInputBuffers`, `updateOutputBuffers` — the link target
   *  for `arduino_runtime_glue.cpp`).  Editor reads this from
   *  `resources/sources/hal/<boardEntry.source>` per-board; web
   *  bundles a single simulator HAL into `getFirmwareFiles()`
   *  already, so it doesn't need this override.
   *
   *  When present, the helper writes the content at the canonical
   *  `src/arduino.cpp` path inside the merged skeleton — matching
   *  the path the editor's pre-refactor `handleGenerateArduinoCppFile`
   *  step used. */
  boardHalContent?: string
}

/**
 * Merge `strucppRuntimeHeaders` (keyed at `strucpp_runtime/include/`)
 * into `firmwareSkeleton` at `src/`.  Returns the merged file map;
 * doesn't mutate `firmwareSkeleton`.
 *
 * Existing entries in `firmwareSkeleton` at `src/<header>` are
 * overwritten by the runtime header — strucpp's headers are the
 * canonical source for those filenames.  The optional
 * `boardHalContent` overwrites any existing `src/arduino.cpp`
 * (web's simulator HAL is dropped in favour of the editor's
 * per-board variant when both are present).
 */
export function mergeStrucppRuntimeIntoSkeleton(args: MergeStrucppRuntimeArgs): Record<string, string> {
  const merged: Record<string, string> = { ...args.firmwareSkeleton }
  for (const [v4Key, content] of Object.entries(args.strucppRuntimeHeaders)) {
    const filename = v4Key.split('/').pop()
    if (!filename) continue
    merged[`src/${filename}`] = content
  }
  if (typeof args.boardHalContent === 'string' && args.boardHalContent.length > 0) {
    merged['src/arduino.cpp'] = args.boardHalContent
  }
  return merged
}
