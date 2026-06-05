/**
 * SFC body walker — JSON-native port of
 * `src/PLCGenerator/sfc.ts:emitSfcBody`.
 *
 * Two-pass algorithm:
 *
 *   1. Pre-pass: walk the body, populate steps / transitions /
 *      jumps / actionBlock entries.  Resolve each step's
 *      predecessor transitions by walking back through divergences /
 *      convergences (depth-bounded by the graph itself).
 *
 *   2. Emit pass: starting from each `initial` step, recursively
 *      emit `INITIAL_STEP` / `STEP` blocks followed by their
 *      outgoing transitions and the destination steps they target.
 *      Action sub-POUs are emitted lazily as referenced.
 *
 * Output matches the existing DOM walker byte-for-byte (verified
 * against the json_walker SFC corpus).
 */

import type { ProgramChunk } from '../ld/path_tree'
import type {
  Connection,
  SfcActionEntry,
  SfcInstance,
  SfcTransitionCondition,
} from './types'
import type { SfcWalkerState } from './walker_state'

/* ─────────────────────────── public entry ───────────────────────────────── */

export function emitSfcBody(state: SfcWalkerState): void {
  // Pre-pass: index all instances by localId for fast lookup, then
  // register each step / transition / jump / actionBlock.
  registerInstances(state)

  // Emit each initial step's reachable subgraph.  The recursive
  // computeSfcStep deletes from `state.sfcSteps` so a back-jump
  // doesn't re-emit the same step.
  for (const stepName of state.initialSteps) {
    computeSfcStep(state, stepName)
  }

  // Any actions still in `state.sfcActions` after the step walk are
  // referenced ones we haven't emitted yet — they should have been
  // visited via `computeSfcStep`'s action-iteration, so the leftover
  // case is unusual.  Mirroring Python: leftover actions don't
  // emit on their own.
}

/* ─────────────────────────── pre-pass ───────────────────────────────────── */

function registerInstances(state: SfcWalkerState): void {
  for (const inst of state.body.instances) {
    state.byId.set(inst.localId, inst)
  }
  for (const inst of state.body.instances) {
    if (inst.kind === 'step') registerStep(state, inst)
    else if (inst.kind === 'jumpStep') registerJump(state, inst)
    else if (inst.kind === 'actionBlock') registerActionBlock(state, inst)
  }
}

function registerStep(state: SfcWalkerState, step: Extract<SfcInstance, { kind: 'step' }>): void {
  if (state.sfcSteps.has(step.name)) return
  if (step.initial) state.initialSteps.push(step.name)
  state.sfcSteps.set(step.name, {
    id: step.localId,
    initial: step.initial,
    transitions: [],
    actions: [],
  })

  // Resolve incoming transitions by walking back through the step's
  // would-be predecessors.  Steps don't carry connections directly
  // in our IR — we discover incoming transitions by looking at every
  // transition's `to` destinations.  Mirror the DOM walker's
  // `resolveStepPredecessorTransitions`.
  for (const candidate of state.body.instances) {
    if (candidate.kind !== 'transition' && candidate.kind !== 'jumpStep') continue
    if (candidate.kind === 'jumpStep') continue
    if (transitionLeadsTo(state, candidate, step.localId)) {
      registerTransition(state, candidate)
      state.sfcTransitions.get(candidate.localId)?.to.push([
        [step.name, [state.tagName, 'transition', candidate.localId, 'to', step.localId]],
      ])
    }
  }
}

function registerJump(state: SfcWalkerState, jump: Extract<SfcInstance, { kind: 'jumpStep' }>): void {
  // jumpStep is a sink — find every transition pointing AT this
  // jumpStep and add its `targetName` to that transition's `to`.
  for (const candidate of state.body.instances) {
    if (candidate.kind !== 'transition') continue
    if (transitionLeadsTo(state, candidate, jump.localId)) {
      registerTransition(state, candidate)
      state.sfcTransitions.get(candidate.localId)?.to.push([
        [jump.targetName, [state.tagName, 'jump', jump.localId, 'target']],
      ])
    }
  }
}

function registerTransition(
  state: SfcWalkerState,
  transition: Extract<SfcInstance, { kind: 'transition' }>,
): void {
  if (state.sfcTransitions.has(transition.localId)) return

  // Walk back from the transition's fromConnections through any
  // divergences / convergences until we hit step(s).  The result is
  // the `from` list (step names).
  const fromSteps = walkBackToSteps(state, transition.fromConnections)

  const fromLocations: ProgramChunk[][] = fromSteps.map((name) => [
    [name, [state.tagName, 'transition', transition.localId, 'from']],
  ])

  state.sfcTransitions.set(transition.localId, {
    id: transition.localId,
    ...(transition.priority !== undefined ? { priority: transition.priority } : {}),
    condition: transition.condition,
    from: fromLocations,
    to: [],
    simultaneous: false,
  })

  // Hook this transition onto each predecessor step's outgoing list.
  for (const stepName of fromSteps) {
    const stepInfos = state.sfcSteps.get(stepName)
    if (stepInfos) stepInfos.transitions.push(transition.localId)
  }
}

/**
 * Walk back from `connections` through divergences/convergences,
 * collecting the upstream step names.  When the upstream is a
 * `simultaneousDivergence`, recurse through its own
 * `fromConnections` — semantically the simultaneous transition's
 * `from` set is the single step driving the divergence.
 */
function walkBackToSteps(state: SfcWalkerState, connections: readonly Connection[]): string[] {
  const out: string[] = []
  for (const conn of connections) {
    const upstream = state.byId.get(conn.refLocalId)
    if (!upstream) continue
    if (upstream.kind === 'step') {
      out.push(upstream.name)
    } else if (
      upstream.kind === 'selectionDivergence' ||
      upstream.kind === 'simultaneousDivergence' ||
      upstream.kind === 'selectionConvergence' ||
      upstream.kind === 'simultaneousConvergence'
    ) {
      out.push(...walkBackToSteps(state, upstream.fromConnections))
    }
  }
  return out
}

/**
 * Forward reachability: does following `transition.toConnections`
 * (which we discover by finding which downstream instance points at
 * the transition) eventually reach `stepLocalId`?
 *
 * We walk through divergences/convergences from the transition's
 * downstream consumers until we find the target step.
 */
function transitionLeadsTo(
  state: SfcWalkerState,
  transition: Extract<SfcInstance, { kind: 'transition' }>,
  stepLocalId: number,
): boolean {
  // Find every instance that has this transition in its
  // fromConnections — those are the transition's downstream
  // consumers.
  for (const candidate of state.body.instances) {
    const consumers = consumerConnectionsOf(candidate)
    if (!consumers) continue
    if (!consumers.some((c) => c.refLocalId === transition.localId)) continue

    if (candidate.kind === 'step' && candidate.localId === stepLocalId) return true
    if (candidate.kind === 'jumpStep' && candidate.localId === stepLocalId) return true
    if (
      candidate.kind === 'selectionDivergence' ||
      candidate.kind === 'simultaneousDivergence' ||
      candidate.kind === 'selectionConvergence' ||
      candidate.kind === 'simultaneousConvergence'
    ) {
      // Recurse through this divergence — its downstream consumers
      // continue the chain.
      if (consumersReach(state, candidate.localId, stepLocalId)) return true
    }
  }
  return false
}

function consumersReach(
  state: SfcWalkerState,
  fromLocalId: number,
  stepLocalId: number,
): boolean {
  for (const candidate of state.body.instances) {
    const consumers = consumerConnectionsOf(candidate)
    if (!consumers) continue
    if (!consumers.some((c) => c.refLocalId === fromLocalId)) continue

    if (candidate.kind === 'step' && candidate.localId === stepLocalId) return true
    if (candidate.kind === 'jumpStep' && candidate.localId === stepLocalId) return true
    if (
      candidate.kind === 'selectionDivergence' ||
      candidate.kind === 'simultaneousDivergence' ||
      candidate.kind === 'selectionConvergence' ||
      candidate.kind === 'simultaneousConvergence'
    ) {
      if (consumersReach(state, candidate.localId, stepLocalId)) return true
    }
  }
  return false
}

function consumerConnectionsOf(inst: SfcInstance): readonly Connection[] | null {
  if (
    inst.kind === 'step' ||
    inst.kind === 'transition' ||
    inst.kind === 'jumpStep' ||
    inst.kind === 'actionBlock' ||
    inst.kind === 'selectionDivergence' ||
    inst.kind === 'selectionConvergence' ||
    inst.kind === 'simultaneousDivergence' ||
    inst.kind === 'simultaneousConvergence'
  ) {
    return inst.fromConnections
  }
  return null
}

function registerActionBlock(
  state: SfcWalkerState,
  block: Extract<SfcInstance, { kind: 'actionBlock' }>,
): void {
  // Each actionBlock has exactly one upstream step.  Walk back
  // through any divergences (rare for actionBlocks) to find it.
  const stepNames = walkBackToSteps(state, block.fromConnections)
  if (stepNames.length === 0) return
  const stepName = stepNames[0]

  block.actions.forEach((action, num) => {
    const stepInfos = state.sfcSteps.get(stepName)
    if (!stepInfos) return
    stepInfos.actions.push({
      id: block.localId,
      num,
      qualifier: action.qualifier,
      ...(action.duration !== undefined ? { duration: action.duration } : {}),
      ...(action.indicator !== undefined ? { indicator: action.indicator } : {}),
      content: action.value,
    })
    if (action.type === 'reference') {
      registerActionDef(state, action)
    }
    // Inline actions are exotic; the existing TS DOM walker doesn't
    // produce a separate ACTION block for them either — the qualifier
    // line in the STEP body is the only emission.
  })
}

function registerActionDef(state: SfcWalkerState, action: SfcActionEntry): void {
  if (state.sfcActions.has(action.value)) return
  const subPou = state.body.actionSubPous.get(action.value)
  if (!subPou) return
  const location: ProgramChunk['1'] = [state.tagName, 'action', action.value, 'name']
  const content: ProgramChunk[] = [
    [`${state.currentIndent}  `, []],
    [subPou.value, [state.tagName, 'action', action.value, 'body']],
    [subPou.value.endsWith('\n') ? '' : '\n', []],
  ]
  state.sfcActions.set(action.value, { location, content })
}

/* ─────────────────────────── emit pass ──────────────────────────────────── */

function computeSfcStep(state: SfcWalkerState, stepName: string): void {
  const stepInfos = state.sfcSteps.get(stepName)
  if (!stepInfos) return
  state.sfcSteps.delete(stepName)

  state.program.push([state.currentIndent, []])
  if (stepInfos.initial) state.program.push(['INITIAL_', []])
  state.program.push(['STEP ', []])
  state.program.push([stepName, [state.tagName, 'step', stepInfos.id, 'name']])
  state.program.push([':\n', []])

  const referencedActions: string[] = []
  state.currentIndent += '  '
  for (const actionInfos of stepInfos.actions) {
    referencedActions.push(actionInfos.content)
    state.program.push([state.currentIndent, []])
    state.program.push([
      actionInfos.content,
      [state.tagName, 'action_block', actionInfos.id, 'action', actionInfos.num, 'reference'],
    ])
    state.program.push(['(', []])
    state.program.push([
      actionInfos.qualifier,
      [state.tagName, 'action_block', actionInfos.id, 'action', actionInfos.num, 'qualifier'],
    ])
    if (actionInfos.duration !== undefined) {
      state.program.push([', ', []])
      state.program.push([
        actionInfos.duration,
        [state.tagName, 'action_block', actionInfos.id, 'action', actionInfos.num, 'duration'],
      ])
    }
    if (actionInfos.indicator !== undefined) {
      state.program.push([', ', []])
      state.program.push([
        actionInfos.indicator,
        [state.tagName, 'action_block', actionInfos.id, 'action', actionInfos.num, 'indicator'],
      ])
    }
    state.program.push([');\n', []])
  }
  state.currentIndent = state.currentIndent.slice(0, -2)
  state.program.push([`${state.currentIndent}END_STEP\n\n`, []])

  for (const actionName of referencedActions) {
    computeSfcAction(state, actionName)
  }
  for (const transitionId of stepInfos.transitions) {
    computeSfcTransition(state, transitionId)
  }
}

function computeSfcAction(state: SfcWalkerState, actionName: string): void {
  const entry = state.sfcActions.get(actionName)
  if (!entry) return
  state.sfcActions.delete(actionName)
  state.program.push([`${state.currentIndent}ACTION `, []])
  state.program.push([actionName, entry.location])
  state.program.push([':\n', []])
  state.program.push(...entry.content)
  state.program.push([`${state.currentIndent}END_ACTION\n\n`, []])
}

function computeSfcTransition(state: SfcWalkerState, transitionId: number): void {
  const infos = state.sfcTransitions.get(transitionId)
  if (!infos) return
  state.sfcTransitions.delete(transitionId)

  state.program.push([`${state.currentIndent}TRANSITION`, []])
  if (infos.priority !== undefined) {
    state.program.push([` (PRIORITY := ${infos.priority})`, [state.tagName, 'transition', transitionId, 'priority']])
  }
  state.program.push([' FROM ', []])
  // Multiple from-steps means simultaneous convergence — render as
  // `(X, Y)`.
  if (infos.from.length === 1) {
    state.program.push(...infos.from[0])
  } else {
    state.program.push(['(', []])
    for (let i = 0; i < infos.from.length; i++) {
      if (i > 0) state.program.push([', ', []])
      state.program.push(...infos.from[i])
    }
    state.program.push([')', []])
  }
  state.program.push([' TO ', []])
  // Multiple to-steps means simultaneous divergence — render as
  // `(X, Y)` (existing DOM emitter convention).
  if (infos.to.length === 1) {
    state.program.push(...infos.to[0])
  } else {
    state.program.push(['(', []])
    for (let i = 0; i < infos.to.length; i++) {
      if (i > 0) state.program.push([', ', []])
      state.program.push(...infos.to[i])
    }
    state.program.push([')', []])
  }
  emitTransitionCondition(state, transitionId, infos.condition)
  state.program.push([`${state.currentIndent}END_TRANSITION\n\n`, []])

  // Recurse into destination steps.
  for (const toGroup of infos.to) {
    for (const [stepName] of toGroup) {
      computeSfcStep(state, stepName)
    }
  }
}

function emitTransitionCondition(
  state: SfcWalkerState,
  transitionId: number,
  condition: SfcTransitionCondition,
): void {
  state.program.push(['\n', []])
  state.currentIndent += '  '
  if (condition.kind === 'inline') {
    state.program.push([state.currentIndent, []])
    state.program.push([':= ', []])
    state.program.push([
      condition.value,
      [state.tagName, 'transition', transitionId, 'inline'],
    ])
    state.program.push([';\n', []])
  } else if (condition.kind === 'reference') {
    const subPou = state.body.transitionSubPous.get(condition.name)
    if (subPou) {
      state.program.push([state.currentIndent, []])
      state.program.push([
        subPou.value,
        [state.tagName, 'transition', transitionId, 'reference', condition.name],
      ])
      // Sub-POU bodies may or may not end with a newline.  Add one
      // if missing so END_TRANSITION lands on its own line.
      if (!subPou.value.endsWith('\n')) state.program.push(['\n', []])
    }
  }
  state.currentIndent = state.currentIndent.slice(0, -2)
}
