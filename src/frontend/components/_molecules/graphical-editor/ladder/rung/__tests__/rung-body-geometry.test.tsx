import {
  ldPouNames,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import { loadedRungs } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import type { OpenPLCStore } from '@root/frontend/store'
import { act, fireEvent } from '@testing-library/react'

import {
  installLadderScreen,
  ladderStore,
  renderLadder,
  resizeEverything,
  settle,
  storedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()

const basic = loadCorpusProject('ld-corpus-basic')

/** The corpus POU as an editor program: its variables and its rungs as the editor loads them. */
function corpusPou(name: string) {
  const pou = basic.pous.find((candidate) => candidate.name === name)
  return { name, variables: pou?.interface?.variables ?? [], rungs: loadedRungs(basic, name) }
}

/** What the store holds for a POU's flow: every rung and the updated flag. */
function savedFlow(store: OpenPLCStore, pouName: string) {
  const flow = store.getState().ladderFlows.find((candidate) => candidate.name === pouName)
  return structuredClone({ updated: flow?.updated, rungs: flow?.rungs ?? [] })
}

describe.each(ldPouNames(basic))('ld-corpus-basic/%s laid out by the engine', (pouName) => {
  async function open() {
    const store = ladderStore([corpusPou(pouName)])
    const before = savedFlow(store, pouName)
    const view = await renderLadder(store, pouName)
    return { store, before, view }
  }

  it('mounting the POU leaves every stored rung, its viewport and the updated flag unchanged', async () => {
    const { store, before } = await open()
    expect(savedFlow(store, pouName)).toEqual(before)
  })

  it('resizing the window and every measured element leaves them unchanged', async () => {
    const { store, before } = await open()
    await resizeEverything(640, 90)
    await resizeEverything(12, 8)
    expect(savedFlow(store, pouName)).toEqual(before)
  })

  it('scrolling each rung leaves them unchanged', async () => {
    const { store, before, view } = await open()
    for (const body of Array.from(view.container.querySelectorAll('[aria-label="Rung body"]'))) {
      fireEvent.scroll(body, { target: { scrollLeft: 300 } })
    }
    await settle()
    expect(savedFlow(store, pouName)).toEqual(before)
  })

  it('re-rendering for a theme switch leaves them unchanged', async () => {
    const { store, before } = await open()
    act(() => store.getState().workspaceActions.switchAppTheme())
    await settle()
    act(() => store.getState().workspaceActions.switchAppTheme())
    await settle()
    expect(savedFlow(store, pouName)).toEqual(before)
  })

  it('keeps one "Rung body" per rung and the xyflow class of every LD node type', async () => {
    const { store, view } = await open()
    const types = [...new Set(storedRungs(store, pouName).flatMap((rung) => rung.nodes.map((node) => node.type)))]
    expect({
      bodies: view.container.querySelectorAll('[aria-label="Rung body"]').length,
      missingTypes: types.filter((type) => view.container.querySelector(`.react-flow__node-${type ?? ''}`) === null),
    }).toEqual({ bodies: storedRungs(store, pouName).length, missingTypes: [] })
  })
})
