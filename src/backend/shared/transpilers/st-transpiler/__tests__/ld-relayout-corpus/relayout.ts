import { createTestStore } from '@root/frontend/store/testing'
import type { HandleBranch, PLCProjectData, PLCVariable, RungLadderState } from '@root/middleware/shared/ports/types'
import type { LadderLabelSource } from '@root/middleware/shared/utils/ladder-layout'
import { applyRungLayout, layoutRung } from '@root/middleware/shared/utils/ladder-layout/layout'

import { type CorpusProjectName, scenariosAt } from './corpus'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRung(value: unknown): value is RungLadderState {
  return isRecord(value) && typeof value.id === 'string' && Array.isArray(value.nodes) && Array.isArray(value.edges)
}

/**
 * A copy of the saved rungs of an LD POU, as the project file holds them.
 * @throws {Error} When the project has no LD body for `pouName`.
 */
export function savedRungs(data: PLCProjectData, pouName: string): RungLadderState[] {
  const pou = data.pous.find((candidate) => candidate.name === pouName)
  const value: unknown = pou?.body.value
  if (!isRecord(value) || !Array.isArray(value.rungs)) throw new Error(`no LD body for POU "${pouName}"`)
  return structuredClone(value.rungs.filter(isRung))
}

/** The handle branches the store derives for each rung when it loads the POU; the project file does not save them. */
export function loadedHandleBranches(
  pouName: string,
  rungs: readonly RungLadderState[],
): (HandleBranch[] | undefined)[] {
  const store = createTestStore()
  store
    .getState()
    .ladderFlowActions.addLadderFlow({ name: pouName, updated: false, rungs: structuredClone([...rungs]) })
  const flow = store.getState().ladderFlows.find((candidate) => candidate.name === pouName)
  return (flow?.rungs ?? []).map((rung) => rung.handleBranches)
}

/** The saved rungs of an LD POU with the handle branches the store adds on load, as the editor holds them. */
export function loadedRungs(data: PLCProjectData, pouName: string): RungLadderState[] {
  const rungs = savedRungs(data, pouName)
  const branches = loadedHandleBranches(pouName, rungs)
  return rungs.map((rung, index) => ({ ...rung, handleBranches: branches[index] }))
}

/** The label source of a POU: its own variables and the resource globals. */
export function corpusLabelSource(data: PLCProjectData, pouName: string): LadderLabelSource {
  const pou = data.pous.find((candidate) => candidate.name === pouName)
  const pouVariables: readonly PLCVariable[] = pou?.interface?.variables ?? []
  return { pouVariables, globalVariables: data.configurations.resource.globalVariables }
}

/** Every rung of `rungs` through `applyRungLayout(rung, layoutRung(rung, src))`. */
export function relayout(rungs: readonly RungLadderState[], src: LadderLabelSource): RungLadderState[] {
  return rungs.map((rung) => applyRungLayout(rung, layoutRung(rung, src)))
}

/** The loaded rungs of an LD POU after the re-layout with the POU's label source. */
export function relayoutPou(data: PLCProjectData, pouName: string): RungLadderState[] {
  return relayout(loadedRungs(data, pouName), corpusLabelSource(data, pouName))
}

/** A copy of the project whose LD POUs hold their rungs after the re-layout; other POUs are unchanged. */
export function relayoutProject(data: PLCProjectData, ldPous: readonly string[]): PLCProjectData {
  const copy = structuredClone(data)
  for (const pou of copy.pous) {
    if (!ldPous.includes(pou.name)) continue
    const value: unknown = pou.body.value
    if (!isRecord(value)) continue
    pou.body = { ...pou.body, value: { ...value, rungs: relayoutPou(data, pou.name) } }
  }
  return copy
}

/** `<project>/<POU>/rung <n> [<scenario ids>]`, as the corpus test names its rungs. */
export function corpusRungName(project: CorpusProjectName, pou: string, rung: number): string {
  const ids = scenariosAt(project, pou, rung).map((scenario) => scenario.id)
  return `${project}/${pou}/rung ${rung} [${ids.join(' ')}]`
}
