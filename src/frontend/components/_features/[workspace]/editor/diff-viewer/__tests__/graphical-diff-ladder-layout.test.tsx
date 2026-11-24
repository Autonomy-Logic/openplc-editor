import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  corpusProjectDir,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  loadedRungs,
  savedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import { renamedRung } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import { computeGraphicalDiff } from '@root/backend/shared/utils/graphical-diff'
import { createTestPorts } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { applyRungLayout, layoutRung } from '@root/middleware/shared/utils/ladder-layout/layout'
import type { RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'
import { parallelEdgeRoute } from '@root/middleware/shared/utils/ladder-layout/wires'

import {
  drawnPoints,
  getTestId,
  installLadderScreen,
  ladderStore,
  nodeElement,
  queryTestId,
  renderWithStore,
  rounded,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'
import { GraphicalDiffViewer } from '../graphical-diff-viewer'

installLadderScreen()

const POU = 'Branches'
const FILE = 'pous/programs/Branches.ld'
const RENAMED = 'Start_Button_Main_Line'
const ELEMENT_TYPES: ReadonlySet<string> = new Set(['contact', 'coil', 'block'])

const data = loadCorpusProject('ld-corpus-parallel-width')
const src = corpusLabelSource(data, POU)
const committed = readFileSync(join(corpusProjectDir('ld-corpus-parallel-width'), ...FILE.split('/')), 'utf8')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The POU file text with its LD body's rungs replaced by `rungs`. */
function withRungs(content: string, rungs: readonly RungLadderState[]): string {
  const start = content.lastIndexOf('END_VAR') + 'END_VAR'.length
  const end = content.lastIndexOf('END_PROGRAM')
  const body: unknown = JSON.parse(content.slice(start, end))
  if (!isRecord(body)) throw new Error('the LD body is not an object')
  return `${content.slice(0, start)}\n\n${JSON.stringify({ ...body, rungs }, null, 2)}\n\n${content.slice(end)}`
}

/** W01 as committed in the old layout, and as the working copy holds it: w01_a renamed, laid out by the engine. */
const head = savedRungs(data, POU)
const before = head[0]
const after = applyRungLayout(
  renamedRung(before, { w01_a: RENAMED }),
  layoutRung(renamedRung(before, { w01_a: RENAMED }), src),
)
const working = withRungs(committed, [after, ...head.slice(1)])

async function openDiff(): Promise<HTMLElement[]> {
  const store = ladderStore([{ name: POU, variables: src.pouVariables, rungs: loadedRungs(data, POU) }])
  const ports = createTestPorts({ capabilities: EDITOR_CAPABILITIES, versionControl: { computeGraphicalDiff } })
  const { container } = await renderWithStore(
    store,
    <GraphicalDiffViewer originalContent={committed} currentContent={working} filePath={FILE} isDark={false} />,
    ports,
  )
  const flows = Array.from(container.querySelectorAll('.react-flow')).filter(
    (flow): flow is HTMLElement => flow instanceof HTMLElement,
  )
  if (flows.length !== 2) throw new Error(`expected the two sides of one changed rung, found ${flows.length} flows`)
  return flows
}

/** The translate xyflow draws a node at, in flow coordinates. */
function drawnPosition(el: Element): { x: number; y: number } {
  const transform = el instanceof HTMLElement ? el.style.transform : ''
  const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(transform)
  if (!match) throw new Error(`node ${el.getAttribute('data-id') ?? ''} has no translate: "${transform}"`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

const SIDES: readonly [string, number, RungLadderState][] = [
  ['previous (committed, old layout)', 0, before],
  ['current (renamed, engine layout)', 1, after],
]

describe.each(SIDES)('the %s side of W01', (_side, index, rung) => {
  const layout: RungLayout = layoutRung(rung, src)

  it("draws every node at the position the editor's layout gives it", async () => {
    const flows = await openDiff()
    const drawn = rung.nodes.map((node) => ({
      id: node.id,
      ...rounded([drawnPosition(nodeElement(flows[index], node.id))])[0],
    }))
    const expected = rung.nodes.map((node) => {
      const geometry = layout.nodes.get(node.id)
      return { id: node.id, ...rounded([geometry?.position ?? { x: NaN, y: NaN }])[0] }
    })
    expect(drawn).toEqual(expected)
  })

  it('draws no element box over another', async () => {
    const flows = await openDiff()
    const boxes = rung.nodes
      .filter((node) => ELEMENT_TYPES.has(node.type ?? ''))
      .map((node) => {
        const at = drawnPosition(nodeElement(flows[index], node.id))
        const geometry = layout.nodes.get(node.id)
        return {
          id: node.id,
          left: at.x,
          top: at.y,
          right: at.x + (geometry?.width ?? 0),
          bottom: at.y + (geometry?.height ?? 0),
        }
      })
    const overlaps = boxes.flatMap((a, i) =>
      boxes
        .slice(i + 1)
        .filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        .map((b) => `${a.id} overlaps ${b.id}`),
    )
    expect(overlaps).toEqual([])
  })

  it('draws every parallel edge through exactly its parallelEdgeRoute points', async () => {
    const flows = await openDiff()
    const routed = rung.edges.flatMap((wire) => {
      const route = parallelEdgeRoute(layout, wire)
      return route === undefined ? [] : [{ wire, route }]
    })
    expect(routed.length).toBeGreaterThan(0)
    for (const { wire, route } of routed) {
      const path = queryTestId(flows[index], `ld-wire-${wire.id}`)
      expect({ edge: wire.id, drawn: path === null ? null : rounded(drawnPoints(path)) }).toEqual({
        edge: wire.id,
        drawn: rounded(route),
      })
    }
  })
})

describe('names in the diff view', () => {
  it('shows the renamed contact whole on the current side and its old name on the previous side', async () => {
    const flows = await openDiff()
    const id = before.nodes.find((node) => {
      const variable: unknown = node.data.variable
      return isRecord(variable) && variable.name === 'w01_a'
    })?.id
    if (id === undefined) throw new Error('W01 has no contact w01_a')
    expect({
      previous: getTestId(flows[0], `ld-name-${id}`).textContent,
      current: getTestId(flows[1], `ld-name-${id}`).textContent,
    }).toEqual({ previous: 'w01_a', current: RENAMED })
  })
})
