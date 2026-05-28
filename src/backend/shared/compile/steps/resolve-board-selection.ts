/**
 * Resolve the user's selected board to the canonical pipeline inputs
 * derived from `hals.json`.
 *
 * Both platforms hand `runCompilePipeline` the same five fields it
 * needs to branch on the target — `boardEntry`, `boardRuntime`,
 * `isSimulator`, `isRuntimeV4`, `isRuntimeV3` — and both used to do
 * the lookup + flag derivation inline at the entry to `compileProgram`,
 * duplicated character-for-character.  Centralising it here keeps the
 * branching logic on one side of the platform boundary so a future
 * tweak (e.g. introducing a new runtime kind) doesn't risk diverging
 * editor and web.
 *
 * Pure: no I/O.  Caller is responsible for loading `hals.json` —
 * editor reads it off disk, web bundles it via Vite's
 * `import.meta.glob`.  The file's content is byte-identical between
 * the two repos (Shared Surface Sync gate).
 *
 * Returns either the resolved selection or an `error` discriminator
 * with a human-readable message the renderer can surface verbatim.
 */

/**
 * Subset of a `hals.json` entry this resolver inspects.  Kept narrow
 * so test fixtures can construct an entry without dragging through
 * every field downstream code consumes.  The full entry shape lives
 * in `backend/shared/firmware/build-arduino-cli-args.ts`.
 */
export interface HalsEntryForSelection {
  /** Runtime identifier — `'simulator'` (avr8js), `'arduino-cli'`
   *  (direct Arduino board), `'openplc-compiler'` (OpenPLC v4 vPLC). */
  compiler?: string
}

export type ResolvedBoardSelection =
  | {
      ok: true
      boardEntry: HalsEntryForSelection & Record<string, unknown>
      boardRuntime: string
      isSimulator: boolean
      isRuntimeV4: boolean
      isRuntimeV3: boolean
    }
  | { ok: false; error: string }

/**
 * Look up `boardTarget` in `halsContent` and derive the four
 * mutually-exclusive runtime flags the pipeline branches on.
 *
 *   - `isRuntimeV3` is decided purely by the boardTarget string
 *     (legacy runtime is a special "OpenPLC Runtime v3" key — no
 *     `compiler` field would let it overlap with v4 otherwise).
 *   - `isRuntimeV4` is derived from `compiler === 'openplc-compiler'`
 *     AND NOT v3 — the v4 vPLC and the legacy v3 daemon share the
 *     `openplc-compiler` field on disk for historical reasons.
 *   - `isSimulator` is the in-browser avr8js path
 *     (`compiler === 'simulator'`).
 *   - The Arduino direct-board path is the residual: not v3, not v4,
 *     not simulator.
 */
export function resolveBoardSelection(
  halsContent: Record<string, HalsEntryForSelection & Record<string, unknown>>,
  boardTarget: string,
): ResolvedBoardSelection {
  const boardEntry = halsContent[boardTarget]
  if (!boardEntry) {
    return {
      ok: false,
      error: `hals.json is missing the "${boardTarget}" entry — bundled asset is out of sync.`,
    }
  }

  const boardRuntime = typeof boardEntry.compiler === 'string' ? boardEntry.compiler : ''
  const isRuntimeV3 = boardTarget === 'OpenPLC Runtime v3'
  const isRuntimeV4 = boardRuntime === 'openplc-compiler' && !isRuntimeV3
  const isSimulator = boardRuntime === 'simulator'

  return {
    ok: true,
    boardEntry,
    boardRuntime,
    isSimulator,
    isRuntimeV4,
    isRuntimeV3,
  }
}
