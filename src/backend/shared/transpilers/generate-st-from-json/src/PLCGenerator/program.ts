/**
 * Body-type dispatcher — the central switch that decides how a POU body
 * becomes ST chunks.
 *
 * Mirrors `PouProgramGenerator.ComputeProgram` (PLCGenerator.py:1285).
 *
 * **Status**:
 *   - IL / ST           — passthrough (Phase 3)
 *   - FBD / LD          — full dispatcher (Phase 4g)
 *   - SFC               — pending (Phase 6)
 *
 * `GeneratePouProgramInText` (the side-effect that walks the IL/ST source
 * looking for referenced POU names and triggers their generation) is a
 * Phase 7 (POU assembly) concern and is **not** invoked here.
 */

import {
  getanyText,
  getbody,
  getcontent,
  getname,
  getpouType,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { type Element, getLocalTag } from '../xmlclass/xsdschema'
import { emitFbdLdBody } from './body_emit'
import { computeConnectionTypes } from './connection_types'
import type { GenState } from './gen_state'
import { newPhase2State } from './graph_primitives'
import { computeInterface } from './interface'
import { emitSfcBody } from './sfc'
import { computePouName, reIndentText } from './text_helpers'

/* ─────────────────────────── chunk model ────────────────────────────────── */

/**
 * One element of `self.Program` in the Python pipeline: a `(text, location)`
 * tuple where `text` is a string fragment to emit and `location` is a
 * variable-arity tuple identifying where the fragment came from (for
 * editor cursor navigation back to the source XML).
 *
 * Python uses `()` for "no location" and `(tagName, "body", indent)` for
 * top-level body text. We model `location` as an array of mixed primitives
 * to preserve the variable arity 1:1.
 *
 * A handful of Python call sites (notably the `VAR_GLOBAL` modifier in
 * `GenerateConfiguration` / `GenerateResource`) nest a `(start, end)` range
 * inside the location tuple, so we allow nested arrays as well.
 */
export type LocationAtom = string | number | readonly (string | number)[]
export type Location = readonly LocationAtom[]
export type ProgramChunk = readonly [text: string, location: Location]

export class NotYetImplementedError extends Error {
  constructor(what: string) {
    super(`Phase 3: ${what} body type is not yet implemented (Phases 4-6).`)
    this.name = 'NotYetImplementedError'
  }
}

/* ─────────────────────────── public API ─────────────────────────────────── */

export interface ComputeProgramOptions {
  /** Initial indentation level in spaces. Python defaults to 2. */
  indent?: number
  /** Project tree, required for type inference on graphical bodies. */
  project?: ProjectTree | Element | null
  /**
   * Optional pre-built GenState to populate. Useful when the caller wants
   * to inspect `state.iface` (declarations added by `extractModifier` /
   * `generateBlock`) or `state.warnings` after compilation. When omitted,
   * a fresh state is built internally and discarded after the return.
   */
  state?: GenState
}

/**
 * Dispatch a POU's body to its language-specific compiler.
 *
 * Returns the emitted `Program` chunk array. For graphical bodies (FBD/LD),
 * the function:
 *   1. Builds (or reuses) a GenState with iface populated by `computeInterface`.
 *   2. Runs `computeConnectionTypes` to populate `connectionTypes` /
 *      `relatedConnections`.
 *   3. Dispatches each instance to its emitter via `emitFbdLdBody`.
 *   4. Returns `state.program`.
 *
 * For IL/ST: returns a single-chunk array `[(reindentedText, [tagName,"body",indent])]`.
 *
 * For SFC: throws `NotYetImplementedError` until Phase 6 lands.
 */
export function computeProgram(
  pou: Element,
  options: ComputeProgramOptions = {},
): ProgramChunk[] {
  const indent = options.indent ?? 2
  const project = options.project ?? null

  const bodies = getbody(pou)
  if (bodies.length === 0) return []
  const body = bodies[0]
  const bodyContent = getcontent(body)
  if (!bodyContent) return []
  const bodyType = getLocalTag(bodyContent)

  const tagName = computePouName(getname(pou) ?? '')

  if (bodyType === 'IL' || bodyType === 'ST') {
    const chunks = emitInlineText(bodyContent, tagName, indent)
    if (options.state) {
      options.state.program.length = 0
      options.state.program.push(...chunks)
    }
    return chunks
  }

  if (bodyType === 'SFC') {
    const sfcState =
      options.state ?? createFreshState(pou, body, tagName, indent, project)
    if (sfcState.connectionTypes.size === 0) {
      runTypeInferenceIntoState(pou, body, project, sfcState)
    }
    emitSfcBody(sfcState, pou, body)
    return sfcState.program
  }

  // FBD / LD path.
  const state =
    options.state ?? createFreshState(pou, body, tagName, indent, project)
  if (state.connectionTypes.size === 0) {
    runTypeInferenceIntoState(pou, body, project, state)
  }
  emitFbdLdBody(state, body)
  return state.program
}

/**
 * Build a fresh GenState — used when callers omit `options.state`.
 * `iface` is pre-populated by `computeInterface` so emitters can read
 * declared variables; further additions (R_TRIG, _TMP_, FB inout aliases)
 * are appended in-place by `extractModifier` / `generateBlock`.
 */
function createFreshState(
  pou: Element,
  body: Element,
  tagName: string,
  indent: number,
  project: ProjectTree | Element | null,
): GenState {
  return {
    pou,
    tagName,
    iface: computeInterface(pou),
    body,
    project,
    program: [],
    currentIndent: ' '.repeat(indent),
    computedConnectors: new Map(),
    computedBlocks: new Map(),
    connectionTypes: new Map(),
    relatedConnections: [],
    warnings: [],
    sfcSteps: new Map(),
    sfcTransitions: new Map(),
    sfcActions: new Map(),
    initialSteps: [],
    sfcComputedBlocks: [],
    actionNumber: 0,
  }
}

/**
 * Run `computeConnectionTypes` into the GenState's connection-type maps.
 * Used both internally and by callers who want to pre-warm a state with
 * just the type-inference results before further work.
 */
function runTypeInferenceIntoState(
  pou: Element,
  body: Element,
  project: ProjectTree | Element | null,
  state: GenState,
): void {
  const phase2 = newPhase2State()
  // Borrow our state's connectionTypes/relatedConnections by reference —
  // computeConnectionTypes mutates them.
  phase2.connectionTypes = state.connectionTypes
  phase2.relatedConnections = state.relatedConnections
  computeConnectionTypes(pou, state.iface, body, phase2, project)
}

/* ──────────────────────── IL / ST passthrough ───────────────────────────── */

/**
 * Emit one chunk containing the body's raw text, re-indented to the current
 * indentation depth. Matches PLCGenerator.py:1294-1299 exactly:
 *
 *   self.Program = [(
 *       ReIndentText(text, len(self.CurrentIndent)),
 *       (self.TagName, "body", len(self.CurrentIndent)),
 *   )]
 *
 * Note: Python passes the text through `.upper()` before `GeneratePouProgramInText`,
 * but that uppercase form is ONLY used for POU-reference scanning — the
 * emitted chunk uses the ORIGINAL case. We mirror by emitting the original.
 */
function emitInlineText(
  bodyContent: Element,
  tagName: string,
  indent: number,
): ProgramChunk[] {
  const text = getanyText(bodyContent)
  return [[reIndentText(text, indent), [tagName, 'body', indent] as const]]
}

/* ──────────────────────────── re-exports ────────────────────────────────── */

// Tag-checking utility for callers that route based on body type without
// triggering a throw.
export function getPouBodyType(pou: Element): string | null {
  const bodies = getbody(pou)
  if (bodies.length === 0) return null
  const content = getcontent(bodies[0])
  if (!content) return null
  return getLocalTag(content)
}

export { getpouType }
