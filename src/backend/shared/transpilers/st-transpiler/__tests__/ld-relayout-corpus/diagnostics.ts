import type { TranspilePou } from '@root/backend/shared/transpilers/st-transpiler'
import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import { fromPortShape } from '@root/backend/shared/transpilers/transpile-from-port'
import type { PLCProjectData, RungLadderState } from '@root/middleware/shared/ports/types'
import { ldSinkOrder } from '@root/middleware/shared/utils/ladder-layout'

import type { CorpusProjectName } from './corpus'

/** The Structured Text of each store rung emitted alone, through the same projection `transpileToSt` uses. */
export function stOfRungs(rungs: readonly RungLadderState[]): string[] {
  const data: PLCProjectData = {
    dataTypes: [],
    pous: [
      {
        name: 'corpus_diff',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'ld', value: { name: 'corpus_diff', rungs } },
      },
    ],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  }
  const pou: TranspilePou | undefined = fromPortShape(data).pous[0]
  if (pou === undefined || pou.body.language !== 'ld') return []
  return pou.body.value.rungs.map((rung) => emitLdBody({ rungs: [rung] }).bodySt)
}

/** The 1-based display position of the rung that holds node `nodeId`, or 0 when no rung holds it. */
function rungOf(rungs: readonly RungLadderState[], nodeId: string): number {
  return rungs.findIndex((rung) => rung.nodes.some((node) => node.id === nodeId)) + 1
}

/**
 * Message naming what changed between two versions of a POU body: "<project>/<POU>/rung <n> (<rung comment>):
 * emitted statements differ" for each rung whose per-rung ST differs, and "<project>/<POU>: statement order differs;
 * first moved sink <nodeId> (rung <n>)" from ldSinkOrder before and after. The moved sink is the one `after` emits at
 * the first position where the two orders differ (the one `before` emits there when `after` has fewer sinks); its rung
 * is read from the version it comes from. Empty string when nothing differs.
 */
export function describeStDifference(
  project: CorpusProjectName,
  pou: string,
  before: readonly RungLadderState[],
  after: readonly RungLadderState[],
): string {
  const lines: string[] = []
  const beforeSt = stOfRungs(before)
  const afterSt = stOfRungs(after)
  for (let index = 0; index < Math.max(beforeSt.length, afterSt.length); index++) {
    if (beforeSt[index] === afterSt[index]) continue
    const changed: RungLadderState | undefined = after[index] ?? before[index]
    lines.push(`${project}/${pou}/rung ${index + 1} (${changed?.comment ?? ''}): emitted statements differ`)
  }
  const beforeOrder = ldSinkOrder(before)
  const afterOrder = ldSinkOrder(after)
  for (let index = 0; index < Math.max(beforeOrder.length, afterOrder.length); index++) {
    if (beforeOrder[index] === afterOrder[index]) continue
    const moved: string | undefined = afterOrder[index]
    const sink = moved ?? beforeOrder[index]
    const rung = moved === undefined ? rungOf(before, sink) : rungOf(after, sink)
    lines.push(`${project}/${pou}: statement order differs; first moved sink ${sink} (rung ${rung})`)
    break
  }
  return lines.join('\n')
}
