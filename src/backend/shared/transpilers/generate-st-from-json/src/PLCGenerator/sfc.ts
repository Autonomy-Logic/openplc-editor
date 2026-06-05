/**
 * Sequential Function Chart (SFC) compilation.
 *
 * Mirrors the SFC machinery in `PouProgramGenerator`:
 *   - `GenerateSFCStep`          (PLCGenerator.py:2019)
 *   - `GenerateSFCJump`          (PLCGenerator.py:2067)
 *   - `GenerateSFCStepActions`   (PLCGenerator.py:2107)
 *   - `GenerateSFCAction`        (PLCGenerator.py:2158)
 *   - `GenerateSFCTransition`    (PLCGenerator.py:2172)
 *   - `ComputeSFCStep`           (PLCGenerator.py:2305)
 *   - `ComputeSFCAction`         (PLCGenerator.py:2354)
 *   - `ComputeSFCTransition`     (PLCGenerator.py:2365)
 *   - `ExtractDivergenceInput`   (PLCGenerator.py:1995)
 *   - `ExtractConvergenceInputs` (PLCGenerator.py:2007)
 *
 * The SFC algorithm has two phases:
 *
 *  1. **Discovery** (`generateSfcBody`): walk every instance in the SFC body
 *     and populate `state.sfcSteps`, `state.sfcTransitions`, `state.sfcActions`
 *     registries plus `state.initialSteps`.
 *
 *  2. **Emission** (`computeSfcStep`): for each initial step, traverse the
 *     network DFS-style, popping registry entries and emitting
 *     `INITIAL_STEP / STEP / END_STEP`, `ACTION / END_ACTION`,
 *     `TRANSITION FROM ... TO ... END_TRANSITION` blocks into `state.program`.
 *
 * **Phase 6 scope (this file)**: simple sequential / branching SFCs.
 * Divergence/convergence helpers (`selectionDivergence`, `selectionConvergence`,
 * `simultaneousDivergence`, `simultaneousConvergence`) are skeleton-ported as
 * helpers; the synthetic corpus exercises only the linear step→transition→step
 * flow plus the jumpStep. Real-Python cross-check catches divergences in the
 * synthetic fixture.
 */

import {
  getaction,
  getactions,
  getbody,
  getconditionContent,
  getconnectionPointIn,
  getconnections,
  getcontent,
  getcontentInstance,
  getcontentInstances,
  getexpression,
  getinitialStep,
  getlocalId,
  getname,
  getpriority,
  getrefLocalId,
  gettargetName,
  gettransition,
  getvariableText,
  hasstep,
  InstanceTag,
} from '../plcopen/accessors'
import { type Element, getLocalTag } from '../xmlclass/xsdschema'
import { PLCGenException } from './connection_types'
import type { GenState, SfcStepActionInfos } from './gen_state'
import { computeExpression } from './path_tree'
import type { Location, ProgramChunk } from './program'
import {
  computePouActionName,
  computePouTransitionName,
  reIndentText,
} from './text_helpers'

/* ────────────────────── divergence/convergence helpers ─────────────────── */

/**
 * Walk an SFC `selectionDivergence` / `simultaneousDivergence` upward through
 * its single inbound link, returning the resolved predecessor instance.
 * Mirrors `ExtractDivergenceInput` (PLCGenerator.py:1995).
 */
function extractDivergenceInput(
  divergence: Element,
  _pou: Element,
  body: Element,
): Element | null {
  const cpIn = getconnectionPointIn(divergence)
  if (!cpIn) return null
  const connections = getconnections(cpIn)
  if (connections.length !== 1) return null
  const refId = getrefLocalId(connections[0])
  if (refId === null) return null
  return getcontentInstance(body, refId)
}

/**
 * Walk an SFC `selectionConvergence` / `simultaneousConvergence` upward
 * through each of its inbound connection points, returning the resolved
 * predecessor instances. Mirrors `ExtractConvergenceInputs`
 * (PLCGenerator.py:2007).
 */
function extractConvergenceInputs(
  convergence: Element,
  _pou: Element,
  body: Element,
): Element[] {
  const out: Element[] = []
  // The convergence has multiple `<connectionPointIn>` children; each carries
  // a single connection to its upstream step / transition.
  for (let i = 0; i < convergence.childNodes.length; i++) {
    const child = convergence.childNodes.item(i)
    if (
      child &&
      child.nodeType === 1 &&
      (child as Element).localName === 'connectionPointIn'
    ) {
      const cpIn = child as Element
      const connections = getconnections(cpIn)
      if (connections.length !== 1) continue
      const refId = getrefLocalId(connections[0])
      if (refId === null) continue
      const instance = getcontentInstance(body, refId)
      if (instance) out.push(instance)
    }
  }
  return out
}

/* ──────────────────── instance-walk helpers (Step predecessor) ──────────── */

/**
 * Resolve the transitions that precede an SFC `<step>` or `<jumpStep>`.
 *
 * Mirrors the predecessor-traversal block in PLCGenerator.py:2031-2052:
 * a step's connectionPointIn may link to (a) a single transition,
 * (b) a selectionConvergence (which fans in multiple transitions), or
 * (c) a simultaneousDivergence (which may itself wrap a selectionConvergence).
 */
function resolveStepPredecessorTransitions(
  step: Element,
  pou: Element,
  body: Element,
): Element[] {
  const cpIn = getconnectionPointIn(step)
  if (!cpIn) return []
  const connections = getconnections(cpIn)
  if (connections.length !== 1) return []
  const refId = getrefLocalId(connections[0])
  if (refId === null) return []
  const instance = getcontentInstance(body, refId)
  if (!instance) return []

  const tag = getLocalTag(instance)
  if (tag === InstanceTag.Transition) return [instance]
  if (tag === 'selectionConvergence') {
    return extractConvergenceInputs(instance, pou, body)
  }
  if (tag === 'simultaneousDivergence') {
    const transition = extractDivergenceInput(instance, pou, body)
    if (transition === null) return []
    const ttag = getLocalTag(transition)
    if (ttag === InstanceTag.Transition) return [transition]
    if (ttag === 'selectionConvergence') {
      return extractConvergenceInputs(transition, pou, body)
    }
  }
  return []
}

/**
 * Resolve the steps that precede an SFC `<transition>`.
 *
 * Mirrors PLCGenerator.py:2174-2192: a transition's predecessor may be
 * (a) a single step, (b) a selectionDivergence (which itself may wrap a
 * step or a simultaneousConvergence), or (c) a simultaneousConvergence
 * (which fans in multiple steps).
 */
function resolveTransitionPredecessorSteps(
  transition: Element,
  pou: Element,
  body: Element,
): Element[] {
  const cpIn = getconnectionPointIn(transition)
  if (!cpIn) return []
  const connections = getconnections(cpIn)
  if (connections.length !== 1) return []
  const refId = getrefLocalId(connections[0])
  if (refId === null) return []
  const instance = getcontentInstance(body, refId)
  if (!instance) return []
  const tag = getLocalTag(instance)
  if (tag === InstanceTag.Step) return [instance]
  if (tag === 'selectionDivergence') {
    const step = extractDivergenceInput(instance, pou, body)
    if (step === null) return []
    const stag = getLocalTag(step)
    if (stag === InstanceTag.Step) return [step]
    if (stag === 'simultaneousConvergence') {
      return extractConvergenceInputs(step, pou, body)
    }
  }
  if (tag === 'simultaneousConvergence') {
    return extractConvergenceInputs(instance, pou, body)
  }
  return []
}

/* ────────────────────── Generate phase ─────────────────────────────────── */

/**
 * Register a step in `state.sfcSteps`. Mirrors `GenerateSFCStep`.
 *
 * For each predecessor transition, registers this step as its `to` target
 * (via `generateSfcTransition`).
 */
export function generateSfcStep(state: GenState, step: Element, pou: Element): void {
  const stepName = getname(step)
  if (stepName === null) return
  if (state.sfcSteps.has(stepName)) return

  const initial = getinitialStep(step)
  if (initial) state.initialSteps.push(stepName)
  const stepId = getlocalId(step) ?? 0
  state.sfcSteps.set(stepName, {
    id: stepId,
    initial,
    transitions: [],
    actions: [],
  })

  const bodies = getbody(pou)
  if (bodies.length === 0) return
  const body = bodies[0]
  const transitions = resolveStepPredecessorTransitions(step, pou, body)
  for (const transition of transitions) {
    generateSfcTransition(state, transition, pou)
    const transitionInfos = state.sfcTransitions.get(transition)
    if (transitionInfos) {
      const targetInfo: Location = [
        state.tagName,
        'transition',
        getlocalId(transition) ?? 0,
        'to',
        stepId,
      ]
      transitionInfos.to.push([[stepName, targetInfo]])
    }
  }
}

/**
 * Register a jump step. Mirrors `GenerateSFCJump` (PLCGenerator.py:2067).
 * Validates the target step exists; registers the jump as a `to` link on
 * each predecessor transition.
 */
export function generateSfcJump(state: GenState, jump: Element, pou: Element): void {
  const targetName = gettargetName(jump)
  if (targetName === null) {
    throw new PLCGenException(`SFC jump in pou "${getname(pou) ?? ''}" has no @targetName`)
  }
  if (!hasstep(pou, targetName)) {
    throw new PLCGenException(
      `SFC jump in pou "${getname(pou) ?? ''}" refers to non-existent SFC step "${targetName}"`,
    )
  }

  const bodies = getbody(pou)
  if (bodies.length === 0) return
  const body = bodies[0]
  const transitions = resolveStepPredecessorTransitions(jump, pou, body)
  for (const transition of transitions) {
    generateSfcTransition(state, transition, pou)
    const transitionInfos = state.sfcTransitions.get(transition)
    if (transitionInfos) {
      const targetInfo: Location = [
        state.tagName,
        'jump',
        getlocalId(jump) ?? 0,
        'target',
      ]
      transitionInfos.to.push([[targetName, targetInfo]])
    }
  }
}

/**
 * Process an `<actionBlock>` instance: connect it to its step, then register
 * each action (inline or by reference). Mirrors `GenerateSFCStepActions`.
 */
export function generateSfcStepActions(
  state: GenState,
  actionBlock: Element,
  pou: Element,
): void {
  const cpIn = getconnectionPointIn(actionBlock)
  if (!cpIn) return
  const connections = getconnections(cpIn)
  if (connections.length !== 1) return
  const refId = getrefLocalId(connections[0])
  if (refId === null) return

  const bodies = getbody(pou)
  if (bodies.length === 0) return
  const body = bodies[0]
  const step = getcontentInstance(body, refId)
  if (!step) return
  generateSfcStep(state, step, pou)
  const stepName = getname(step)
  if (stepName === null || !state.sfcSteps.has(stepName)) return
  const stepInfos = state.sfcSteps.get(stepName)
  if (!stepInfos) return

  const actions = getactions(actionBlock)
  const actionBlockId = getlocalId(actionBlock) ?? 0
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const infos: SfcStepActionInfos = {
      id: actionBlockId,
      qualifier: action.qualifier,
      content: action.value,
      num: i,
    }
    if (action.duration !== undefined) infos.duration = action.duration
    if (action.indicator !== undefined) infos.indicator = action.indicator
    if (action.type === 'reference') {
      generateSfcAction(state, action.value, pou)
    } else {
      // Inline action — synthesize a unique action name and register its body.
      state.actionNumber += 1
      const actionName = `${stepName.toUpperCase()}_INLINE${state.actionNumber}`
      const inlineLocation: Location = [
        state.tagName,
        'action_block',
        actionBlockId,
        'action',
        i,
        'inline',
      ]
      state.sfcActions.set(actionName, {
        content: [
          [state.currentIndent, []],
          [action.value, inlineLocation],
          ['\n', []],
        ],
        location: [],
      })
      infos.content = actionName
    }
    stepInfos.actions.push(infos)
  }
}

/**
 * Register a named action sub-POU's body in `state.sfcActions`. Mirrors
 * `GenerateSFCAction` (PLCGenerator.py:2158). The action body is compiled
 * recursively via a deferred-import handle to avoid an import cycle with
 * `program.ts`.
 */
export function generateSfcAction(
  state: GenState,
  actionName: string,
  pou: Element,
): void {
  if (state.sfcActions.has(actionName)) return
  const actionElement = getaction(pou, actionName)
  if (!actionElement) return

  // Defer-import to avoid the program.ts <-> sfc.ts cycle.
  // We need a fresh sub-emission: save state's program/tagName, compile, swap back.
  const previousTagName = state.tagName
  state.tagName = computePouActionName(getname(pou) ?? '', actionName)
  const savedProgram = state.program
  state.program = []
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { computeProgram } = require('./program') as typeof import('./program')
  // Run computeProgram on the action sub-POU. Its body becomes the action's
  // emitted content. We pass the *parent* GenState so iface mutations and
  // type inference share scope.
  computeProgram(actionElement, { project: state.project, state })
  const actionContent = state.program
  state.program = savedProgram
  state.sfcActions.set(actionName, {
    content: actionContent,
    location: [state.tagName, 'name'],
  })
  state.tagName = previousTagName
}

/**
 * Register a transition's predecessor links + condition content. Mirrors
 * `GenerateSFCTransition` (PLCGenerator.py:2172).
 */
export function generateSfcTransition(
  state: GenState,
  transition: Element,
  pou: Element,
): void {
  if (state.sfcTransitions.has(transition)) return

  const bodies = getbody(pou)
  if (bodies.length === 0) return
  const body = bodies[0]
  const steps = resolveTransitionPredecessorSteps(transition, pou, body)

  const transitionId = getlocalId(transition) ?? 0
  const priority = getpriority(transition)
  state.sfcTransitions.set(transition, {
    id: transitionId,
    priority,
    from: [],
    to: [],
    content: [],
  })
  const transitionInfos = state.sfcTransitions.get(transition)!

  const condition = getconditionContent(transition)
  if (condition === null) {
    // Skip — body lacks a condition. Real Python would also produce no content.
  } else if (condition.kind === 'inline') {
    transitionInfos.content = [
      [`\n${state.currentIndent}:= `, []],
      [
        condition.value,
        [state.tagName, 'transition', transitionId, 'inline'],
      ],
      [';\n', []],
    ]
  } else if (condition.kind === 'reference') {
    const transitionSubPou = gettransition(pou, condition.value)
    if (transitionSubPou !== null) {
      const transitionBodies = getbody(transitionSubPou)
      if (transitionBodies.length > 0) {
        const transitionBody = transitionBodies[0]
        const previousTagName = state.tagName
        state.tagName = computePouTransitionName(
          getname(pou) ?? '',
          condition.value,
        )
        const content = getcontent(transitionBody)
        const transitionType = content ? getLocalTag(content) : null
        if (transitionType === 'IL') {
          transitionInfos.content = [
            [':\n', []],
            [
              reIndentText(content?.textContent ?? '', state.currentIndent.length),
              [state.tagName, 'body', state.currentIndent.length],
            ],
          ]
        } else if (transitionType === 'ST') {
          // For ST conditions, getanyText reads the <p> child's text content.
          const innerP = content ? findFirstP(content) : null
          const text = innerP?.textContent ?? ''
          transitionInfos.content = [
            ['\n', []],
            [
              reIndentText(text, state.currentIndent.length),
              [state.tagName, 'body', state.currentIndent.length],
            ],
          ]
        } else {
          // LD/FBD — look for the outVariable/coil that matches the transition name.
          let matched = false
          for (const instance of getcontentInstances(transitionBody)) {
            const tag = getLocalTag(instance)
            const matchesName =
              (tag === InstanceTag.OutVariable &&
                getexpression(instance) === condition.value) ||
              (tag === InstanceTag.Coil &&
                getvariableText(instance) === condition.value)
            if (!matchesName) continue
            const innerCpIn = getconnectionPointIn(instance)
            if (!innerCpIn) continue
            const innerConnections = getconnections(innerCpIn)
            if (innerConnections.length === 0) continue
            const expression = computeExpression(
              state,
              transitionBody,
              innerConnections,
            )
            if (expression !== null) {
              transitionInfos.content = [
                [`\n${state.currentIndent}:= `, []],
                ...expression,
                [';\n', []],
              ]
              // Any side-effect chunks (e.g. block calls) need to land in
              // sfcComputedBlocks so they're emitted before the SFC framework.
              state.sfcComputedBlocks.push(...state.program)
              state.program = []
              matched = true
            }
          }
          if (!matched) {
            throw new PLCGenException(
              `Transition "${condition.value}" body must contain an output variable or coil referring to its name`,
            )
          }
        }
        state.tagName = previousTagName
      }
    }
  } else if (condition.kind === 'connection') {
    const innerConnections = getconnections(condition.value)
    if (innerConnections.length > 0) {
      const expression = computeExpression(state, body, innerConnections)
      if (expression !== null) {
        transitionInfos.content = [
          [`\n${state.currentIndent}:= `, []],
          ...expression,
          [';\n', []],
        ]
        state.sfcComputedBlocks.push(...state.program)
        state.program = []
      }
    }
  }

  for (const step of steps) {
    generateSfcStep(state, step, pou)
    const stepName = getname(step)
    if (stepName === null || !state.sfcSteps.has(stepName)) continue
    const stepId = getlocalId(step) ?? 0
    transitionInfos.from.push([
      [
        stepName,
        [state.tagName, 'transition', transitionId, 'from', stepId],
      ],
    ])
    state.sfcSteps.get(stepName)?.transitions.push(transition)
  }
}

/* ────────────────────── Compute phase (emission) ───────────────────────── */

/**
 * Walk a single SFC step + its outgoing transitions + downstream steps,
 * emitting the `INITIAL_STEP/STEP/END_STEP` + `ACTION/END_ACTION` +
 * `TRANSITION...END_TRANSITION` blocks. DFS via the registries built by
 * `generateSfcStep` / `generateSfcTransition`.
 *
 * Mirrors `ComputeSFCStep` (PLCGenerator.py:2305). The registries are
 * popped during traversal so each node is emitted exactly once.
 */
export function computeSfcStep(state: GenState, stepName: string): void {
  const stepInfos = state.sfcSteps.get(stepName)
  if (!stepInfos) return
  state.sfcSteps.delete(stepName)

  state.program.push([state.currentIndent, []])
  if (stepInfos.initial) state.program.push(['INITIAL_', []])
  state.program.push(['STEP ', []])
  state.program.push([
    stepName,
    [state.tagName, 'step', stepInfos.id, 'name'],
  ])
  state.program.push([':\n', []])

  const actions: string[] = []
  state.currentIndent += '  '
  for (const actionInfos of stepInfos.actions) {
    const actionInfo: Location =
      actionInfos.id !== undefined
        ? [
            state.tagName,
            'action_block',
            actionInfos.id,
            'action',
            actionInfos.num,
          ]
        : []
    actions.push(actionInfos.content)
    state.program.push([state.currentIndent, []])
    state.program.push([
      actionInfos.content,
      [...actionInfo, 'reference'],
    ])
    state.program.push(['(', []])
    state.program.push([
      actionInfos.qualifier,
      [...actionInfo, 'qualifier'],
    ])
    if (actionInfos.duration !== undefined) {
      state.program.push([', ', []])
      state.program.push([
        actionInfos.duration,
        [...actionInfo, 'duration'],
      ])
    }
    if (actionInfos.indicator !== undefined) {
      state.program.push([', ', []])
      state.program.push([
        actionInfos.indicator,
        [...actionInfo, 'indicator'],
      ])
    }
    state.program.push([');\n', []])
  }
  state.currentIndent = state.currentIndent.slice(0, -2)
  state.program.push([`${state.currentIndent}END_STEP\n\n`, []])

  for (const actionName of actions) {
    computeSfcAction(state, actionName)
  }
  for (const transition of stepInfos.transitions) {
    computeSfcTransition(state, transition)
  }
}

/**
 * Emit an `ACTION <name>: ... END_ACTION` block.
 */
export function computeSfcAction(state: GenState, actionName: string): void {
  const entry = state.sfcActions.get(actionName)
  if (!entry) return
  state.sfcActions.delete(actionName)
  state.program.push([`${state.currentIndent}ACTION `, []])
  state.program.push([actionName, entry.location])
  state.program.push([':\n', []])
  state.program.push(...entry.content)
  state.program.push([`${state.currentIndent}END_ACTION\n\n`, []])
}

/**
 * Emit a `TRANSITION ... FROM ... TO ... := ...; END_TRANSITION` block,
 * then recursively `computeSfcStep` for each downstream target.
 */
export function computeSfcTransition(state: GenState, transition: Element): void {
  const infos = state.sfcTransitions.get(transition)
  if (!infos) return
  state.sfcTransitions.delete(transition)

  state.program.push([`${state.currentIndent}TRANSITION`, []])
  if (infos.priority !== null) {
    state.program.push([' (PRIORITY := ', []])
    state.program.push([
      String(infos.priority),
      [state.tagName, 'transition', infos.id, 'priority'],
    ])
    state.program.push([')', []])
  }

  state.program.push([' FROM ', []])
  if (infos.from.length > 1) {
    state.program.push(['(', []])
    appendJoined(state.program, [[', ', []]], infos.from)
    state.program.push([')', []])
  } else if (infos.from.length === 1) {
    state.program.push(...infos.from[0])
  } else {
    throw new PLCGenException(
      `Transition not connected to a previous step in "${getname(state.pou) ?? ''}" POU`,
    )
  }

  state.program.push([' TO ', []])
  if (infos.to.length > 1) {
    state.program.push(['(', []])
    appendJoined(state.program, [[', ', []]], infos.to)
    state.program.push([')', []])
  } else if (infos.to.length === 1) {
    state.program.push(...infos.to[0])
  } else {
    throw new PLCGenException(
      `Transition not connected to a next step in "${getname(state.pou) ?? ''}" POU`,
    )
  }

  state.program.push(...infos.content)
  state.program.push([`${state.currentIndent}END_TRANSITION\n\n`, []])

  for (const target of infos.to) {
    // target is `[[stepName, location]]`. Extract step name.
    if (target.length > 0 && typeof target[0][0] === 'string') {
      computeSfcStep(state, target[0][0])
    }
  }
}

/* ────────────────────── SFC body dispatcher ────────────────────────────── */

/**
 * Drive SFC body compilation. Mirrors the SFC branch of `ComputeProgram`
 * (PLCGenerator.py:1300-1321).
 *
 *   1. Indent right.
 *   2. For each instance: dispatch by tag (Step / ActionBlock / Transition / JumpStep).
 *   3. Indent left.
 *   4. For each initialStep: `computeSfcStep` (which recursively traverses
 *      via the registries).
 *
 * Skipped: the `SFCComputedBlocks` "COMPUTE_FUNCTION_BLOCKS" action that
 * appears when the initial step needs to run inline ST/IL function-block
 * code on entry. Python `state.SFCComputedBlocks` accumulates those chunks;
 * we accumulate into `state.sfcComputedBlocks` similarly but don't yet emit
 * the synthesized action. No corpus coverage; revisit if/when an SFC fixture
 * triggers it.
 */
export function emitSfcBody(state: GenState, pou: Element, body: Element): void {
  state.currentIndent += '  '
  for (const instance of getcontentInstances(body)) {
    const tag = getLocalTag(instance)
    if (tag === InstanceTag.Step) {
      generateSfcStep(state, instance, pou)
    } else if (tag === 'actionBlock') {
      generateSfcStepActions(state, instance, pou)
    } else if (tag === InstanceTag.Transition) {
      generateSfcTransition(state, instance, pou)
    } else if (tag === InstanceTag.Jump) {
      generateSfcJump(state, instance, pou)
    }
  }
  state.currentIndent = state.currentIndent.slice(0, -2)

  // Any SFC transitions that pulled in LD/FBD blocks recorded their call
  // chunks in sfcComputedBlocks; prepend them to the main emission so the
  // block calls happen before the SFC framework.
  if (state.sfcComputedBlocks.length > 0) {
    state.program.push(...state.sfcComputedBlocks)
    state.sfcComputedBlocks = []
  }

  for (const stepName of state.initialSteps) {
    computeSfcStep(state, stepName)
  }
}

/* ────────────────────── helpers ────────────────────────────────────────── */

function appendJoined(
  out: ProgramChunk[],
  separator: readonly ProgramChunk[],
  items: readonly (readonly ProgramChunk[])[],
): void {
  for (let i = 0; i < items.length; i++) {
    if (i > 0) out.push(...separator)
    out.push(...items[i])
  }
}

function findFirstP(container: Element): Element | null {
  for (let i = 0; i < container.childNodes.length; i++) {
    const c = container.childNodes.item(i)
    if (c && c.nodeType === 1 && (c as Element).localName === 'p') {
      return c as Element
    }
  }
  return null
}
