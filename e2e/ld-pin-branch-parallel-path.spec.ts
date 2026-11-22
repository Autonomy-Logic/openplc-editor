/**
 * Contacts added on the parallel path of a block pin's input network land where the marker shows: built through the
 * editor's UI on CTUD.LD, saved, and turned into ST by the transpiler the compiler runs on the saved POU.
 *
 * Run against a production build (see "Electron e2e" in CLAUDE.md):
 * `npx playwright test e2e/ld-pin-branch-parallel-path.spec.ts --workers=1`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { emitLdBody } from '../src/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFRung } from '../src/backend/shared/transpilers/st-transpiler/walker/types'
import { parseGraphicalPouFromString } from '../src/frontend/utils/PLC/pou-text-parser'
import { freshDirectory, freshProfile } from './helpers/editor-session'
import { shutdown } from './helpers/electron-editor'
import {
  createProject,
  type DropStep,
  LadderBuilder,
  launchOn,
  type Marker,
  pouFileHolds,
  type Ref,
  saveAndWait,
} from './helpers/ladder-builder'

const STEP_7 = 'l right of k on the CTUD LD network'
const STEP_8 = 'm below l on the CTUD LD network'

const rail: Marker = { rail: 'left' }
const right = (ref: Ref): Marker => ({ right: ref })
const below = (ref: Ref): Marker => ({ below: ref })
const contact = (as: Ref, at: Marker): DropStep => ({ drop: 'contact', at, as, name: as })

/** Steps 1-7: a -> CTUD -> qu, then i on the LD pin, k below i, j right of i, l right of k. */
const STEPS_1_TO_7: readonly DropStep[] = [
  contact('a', rail),
  { drop: { block: 'CTUD', library: 'Standard Function Blocks' }, at: right('a'), as: 'c' },
  { drop: 'coil', at: right('c'), as: 'qu', name: 'qu' },
  contact('i', { handle: 'c', pin: 'LD' }),
  contact('k', below('i')),
  contact('j', right('i')),
  contact('l', right('k')),
]

/** True for an LD body whose rungs each hold node and edge arrays. */
function isLdBody(value: unknown): value is { rungs: RFRung[] } {
  if (typeof value !== 'object' || value === null || !('rungs' in value) || !Array.isArray(value.rungs)) return false
  return value.rungs.every(
    (rung: unknown) =>
      typeof rung === 'object' &&
      rung !== null &&
      'nodes' in rung &&
      Array.isArray(rung.nodes) &&
      'edges' in rung &&
      Array.isArray(rung.edges),
  )
}

/** The saved rung whose comment is `comment`. */
function savedRung(projectDir: string, comment: string): RFRung {
  const text = readFileSync(join(projectDir, 'pous', 'programs', 'main.ld'), 'utf8')
  const { body } = parseGraphicalPouFromString(text, 'ld', 'program')
  if (body.language !== 'ld' || !isLdBody(body.value)) throw new Error('main.ld holds no LD rungs')
  const rung = body.value.rungs.find((candidate) => candidate.comment === comment)
  if (rung === undefined) throw new Error(`main.ld has no rung "${comment}"`)
  return rung
}

/** The node of `rung` whose variable is `name`. */
function nodeNamed(rung: RFRung, name: string): RFRung['nodes'][number] {
  const node = rung.nodes.find((candidate) => {
    const variable = candidate.data.variable
    return typeof variable === 'object' && variable !== null && 'name' in variable && variable.name === name
  })
  if (node === undefined) throw new Error(`the rung has no element named ${name}`)
  return node
}

/** Types of the nodes wired downstream of the node named `name`, rails excluded. */
function downstreamOf(rung: RFRung, name: string): string[] {
  const seen = new Set<string>()
  const queue = [nodeNamed(rung, name).id]
  while (queue.length > 0) {
    const id = queue.shift() ?? ''
    for (const edge of rung.edges.filter((candidate) => candidate.source === id && !seen.has(candidate.target))) {
      seen.add(edge.target)
      queue.push(edge.target)
    }
  }
  return rung.nodes.filter((node) => seen.has(node.id) && node.type !== 'powerRail').map((node) => node.type)
}

/** The argument the generated ST passes to the CTUD's LD pin. */
function ldExpression(rung: RFRung): string {
  const { bodySt } = emitLdBody({ rungs: [rung] })
  const match = /\bLD := /.exec(bodySt)
  if (match === null) throw new Error(`the generated ST has no LD argument:\n${bodySt}`)
  let depth = 0
  let end = match.index + match[0].length
  for (; end < bodySt.length; end++) {
    if (bodySt[end] === '(') depth++
    else if (bodySt[end] === ')' && depth-- === 0) break
    else if (bodySt[end] === ',' && depth === 0) break
  }
  return bodySt.slice(match.index + match[0].length, end).trim()
}

/** The contact names an expression reads. */
const operands = (expression: string): string[] =>
  (expression.match(/[A-Za-z_]\w*/g) ?? []).filter((token) => token !== 'AND' && token !== 'OR').sort()

test('contacts on a CTUD LD pin parallel path are wired where the marker shows', async () => {
  test.setTimeout(180_000)
  const session = await launchOn(freshProfile('ld-pin-branch'))
  try {
    const projectDir = await createProject(session, freshDirectory('ld-pin-branch'), 'ld-pin-branch')
    const builder = new LadderBuilder(session.page)
    await builder.buildRung({ comment: STEP_7, steps: STEPS_1_TO_7 }, 'step 7')
    await saveAndWait(session, ['main'], () => pouFileHolds(projectDir, 'main', [STEP_7]), 'step 7')

    const step7 = savedRung(projectDir, STEP_7)
    expect(downstreamOf(step7, 'qu'), 'elements wired after coil qu').toEqual([])
    expect(operands(ldExpression(step7)), `LD := ${ldExpression(step7)}`).toEqual(['i', 'j', 'k', 'l'])

    await builder.buildRung({ comment: STEP_8, steps: [...STEPS_1_TO_7, contact('m', below('l'))] }, 'step 8')
    await saveAndWait(session, ['main'], () => pouFileHolds(projectDir, 'main', [STEP_7, STEP_8]), 'step 8')

    const step8 = savedRung(projectDir, STEP_8)
    expect(downstreamOf(step8, 'qu'), 'elements wired after coil qu').toEqual([])
    expect(operands(ldExpression(step8)), `LD := ${ldExpression(step8)}`).toEqual(['i', 'j', 'k', 'l', 'm'])
    const l = nodeNamed(step8, 'l').id
    const m = nodeNamed(step8, 'm').id
    const opens = step8.nodes.filter((node) => node.type === 'parallel' && node.data.type === 'open')
    const closes = step8.nodes.filter((node) => node.type === 'parallel' && node.data.type === 'close')
    const feeds = (from: string, to: string) => step8.edges.some((edge) => edge.source === from && edge.target === to)
    expect(
      opens.some((open) => feeds(open.id, l) && feeds(open.id, m)) &&
        closes.some((close) => feeds(l, close.id) && feeds(m, close.id)),
      'm sits in a parallel with l, opened and closed by the same junctions',
    ).toBe(true)
  } catch (error) {
    await session.page.screenshot({ path: test.info().outputPath('failure.png') }).catch(() => undefined)
    throw error
  } finally {
    await shutdown(session.app)
  }
})
