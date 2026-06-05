/**
 * Mutable state carried through the SFC walker.
 *
 * Mirrors the relevant subset of `GenState` the existing DOM walker
 * uses for SFC emission: per-name step / transition / action maps,
 * an initial-step queue, and the accumulating program chunk stream.
 */

import type { ProgramChunk } from '../ld/path_tree'
import type { SfcBody, SfcInstance, SfcTransitionCondition } from './types'

export interface SfcStepActionEntry {
  id: number
  num: number
  qualifier: string
  duration?: string
  indicator?: string
  /** For `<reference>` actions, the sub-POU name; for `<inline>`
   *  actions, the inline ST text (one-line). */
  content: string
}

export interface SfcStepInfos {
  id: number
  initial: boolean
  /** localIds of outgoing transitions. */
  transitions: number[]
  actions: SfcStepActionEntry[]
}

export interface SfcTransitionInfos {
  id: number
  priority?: number
  condition: SfcTransitionCondition
  /** Each element is one chunk-list representing an upstream step
   *  name.  When length > 1 we render as `(X, Y)` (simultaneous
   *  convergence). */
  from: ProgramChunk[][]
  /** Each element is one chunk-list representing a downstream step
   *  name.  When length > 1 we render as `(X, Y)` (simultaneous
   *  divergence). */
  to: ProgramChunk[][]
  /** When true, both `from` and `to` are treated as parenthesised
   *  groups (simultaneous semantics). */
  simultaneous: boolean
}

export interface SfcActionInfos {
  location: ProgramChunk['1']
  content: ProgramChunk[]
}

export interface SfcWalkerState {
  tagName: string
  body: SfcBody
  byId: Map<number, SfcInstance>
  program: ProgramChunk[]
  currentIndent: string
  sfcSteps: Map<string, SfcStepInfos>
  sfcTransitions: Map<number, SfcTransitionInfos>
  sfcActions: Map<string, SfcActionInfos>
  initialSteps: string[]
  warnings: string[]
}

export function newSfcWalkerState(tagName: string, body: SfcBody): SfcWalkerState {
  return {
    tagName,
    body,
    byId: new Map(),
    program: [],
    currentIndent: '  ',
    sfcSteps: new Map(),
    sfcTransitions: new Map(),
    sfcActions: new Map(),
    initialSteps: [],
    warnings: [],
  }
}
