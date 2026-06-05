/**
 * Mutable code-generation state shared across Phase 4+ functions.
 *
 * Mirrors the `self.*` fields of `PouProgramGenerator` (PLCGenerator.py:705)
 * that the FBD/LD/SFC compilers read or write — but flattened into an
 * explicit value passed between functions, so each function stays testable
 * in isolation.
 *
 * What's modeled:
 *   - `pou`, `tagName`, `iface`, `body`, `project`: input context.
 *   - `program`: the chunk list each emit appends to (mirrors `self.Program`).
 *   - `currentIndent`: leading-space prefix for emitted lines.
 *   - `computedConnectors`: cache of expressions for named connectors
 *     (mirrors `self.ComputedConnectors`).
 *   - `connectionTypes` + `relatedConnections`: populated by Phase 2c+2e.
 *
 * What's deferred:
 *   - SFC-specific state (`SFCNetworks`, `SFCComputedBlocks`, `InitialSteps`,
 *     `ActionNumber`) lands when Phase 6 ports SFC emission.
 *   - `PouComputed`, `Errors`, `Warnings` are pipeline-level concerns owned
 *     by the eventual `ProgramGenerator` port (Phase 7+).
 */

import type { ProjectTree } from '../plcopen/plcopen'
import type { Element } from '../xmlclass/xsdschema'
import type { InterfaceEntry } from './interface'
import type { Location, ProgramChunk } from './program'

export interface GenState {
  /** The POU being compiled. */
  pou: Element
  /** `"P::pouName"` — first field of every location tuple emitted from this POU. */
  tagName: string
  /** Mutable variable interface. `AddTrigger` appends synthesized `R_TRIG` / `F_TRIG` vars. */
  iface: InterfaceEntry[]
  /** The body element being compiled. */
  body: Element
  /** Optional project root for block-library lookups + dot-path resolution. */
  project: ProjectTree | Element | null

  /** Accumulating chunk output. Functions append; the final program is the array. */
  program: ProgramChunk[]
  /** Leading-space prefix. Mutated by `indentRight()` / `indentLeft()`. */
  currentIndent: string

  /** Cache of expression chunks keyed by named-connector identifier. */
  computedConnectors: Map<string, ProgramChunk[]>
  /**
   * Tracks block instances whose call statement has already been emitted into
   * `program` — `GenerateBlock` checks this to avoid re-emitting when multiple
   * downstream consumers reference the same block's outputs. Mirrors
   * `self.ComputedBlocks` in PLCGenerator.py.
   */
  computedBlocks: Map<Element, boolean>

  /** Phase 2 results — connection-point → IEC type. */
  connectionTypes: Map<Element, string>
  /** Phase 2 results — groups of unresolved-type connection points. */
  relatedConnections: Element[][]

  /**
   * Non-fatal warnings emitted during generation (e.g., a function call
   * cancelled because no inputs were connected). Mirrors `self.Warnings`.
   */
  warnings: string[]

  /* ─────────────────────── SFC-specific state (Phase 6) ──────────────── */

  /**
   * SFC step registry. Keyed by step name. Each entry tracks `id`,
   * `initial`, plus `actions` (list of action-block descriptors) and
   * `transitions` (list of transition elements outgoing from this step).
   * Populated by `generateSFCStep`; drained by `computeSFCStep`.
   */
  sfcSteps: Map<string, SfcStepInfos>

  /**
   * SFC transition registry. Keyed by the transition Element (identity).
   * Populated by `generateSFCTransition`; drained by `computeSFCTransition`.
   */
  sfcTransitions: Map<Element, SfcTransitionInfos>

  /**
   * SFC action registry. Keyed by action name (either the named action's
   * `@name` or a synthesized `STEPNAME_INLINEn` for inline action blocks).
   * Each entry holds the action body chunks + a location tuple.
   */
  sfcActions: Map<string, { content: ProgramChunk[]; location: Location }>

  /** Names of initial steps in document order. */
  initialSteps: string[]

  /**
   * Auxiliary chunks emitted while resolving SFC transition conditions that
   * pull in LD/FBD blocks. Concatenated into the main program before the
   * SFC framework's `STEP`/`TRANSITION`/`ACTION` output.
   */
  sfcComputedBlocks: ProgramChunk[]

  /**
   * Counter used to mint unique synthesized action names for inline action
   * blocks. Mirrors `self.ActionNumber`.
   */
  actionNumber: number
}

export interface SfcStepInfos {
  id: number
  initial: boolean
  /** Outgoing transitions from this step (stored as the Element keys). */
  transitions: Element[]
  /** Action-block descriptors attached to this step. */
  actions: SfcStepActionInfos[]
}

export interface SfcStepActionInfos {
  /** Action-block instance localId; absent for "synthetic" actions. */
  id?: number
  qualifier: string
  /** Either the action sub-POU name (reference) or a synthesized inline name. */
  content: string
  num: number
  duration?: string
  indicator?: string
}

export interface SfcTransitionInfos {
  id: number
  priority: number | null
  /** Predecessor step names with location info. */
  from: ProgramChunk[][]
  /** Successor step names with location info. */
  to: ProgramChunk[][]
  /** Condition chunks (the `:= expr;` part of the emitted TRANSITION). */
  content: ProgramChunk[]
}

/**
 * Indent right by one tab-stop (Python's `IndentRight` adds two spaces;
 * `IndentLeft` removes them).
 */
export function indentRight(state: GenState): void {
  state.currentIndent += '  '
}

export function indentLeft(state: GenState): void {
  if (state.currentIndent.length >= 2) {
    state.currentIndent = state.currentIndent.slice(0, -2)
  }
}

/**
 * Check whether an identifier is already declared in the interface.
 * Mirrors `PouProgramGenerator.IsAlreadyDefined` (PLCGenerator.py:778).
 */
export function isAlreadyDefined(state: GenState, name: string): boolean {
  for (const entry of state.iface) {
    for (const v of entry.vars) {
      if (v.name === name) return true
    }
  }
  return false
}
