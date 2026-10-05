/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../../store'
import { createTestStore } from '../../../store/testing'
import { redirectToGraphicalPou } from '../graphical-redirect'
import { pouUri, stubUri } from '../types'

function setProjectPous(pous: PLCPou[]) {
  store.setState((s) => ({
    ...s,
    project: {
      ...s.project,
      data: { ...s.project.data, pous },
    },
  }))
}

function pou(
  name: string,
  language: 'st' | 'il' | 'ld' | 'fbd' | 'sfc',
  pouType: 'program' | 'function' | 'function-block' = 'function-block',
): PLCPou {
  return {
    name,
    pouType,
    interface: { variables: [] },
    body: { language, value: language === 'st' ? '' : ({} as never) },
    documentation: '',
  } as PLCPou
}

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
  setProjectPous([])
})

describe('redirectToGraphicalPou', () => {
  it('returns false for URIs that are not stub:// URIs', () => {
    expect(redirectToGraphicalPou(store, pouUri('Foo'))).toBe(false)
    expect(redirectToGraphicalPou(store, 'file:///foo.st')).toBe(false)
    expect(redirectToGraphicalPou(store, '')).toBe(false)
  })

  it('returns false when no project POU matches the name', () => {
    setProjectPous([pou('Other', 'ld')])
    expect(redirectToGraphicalPou(store, stubUri('Missing'))).toBe(false)
  })

  it('returns false when the matching POU is not graphical', () => {
    // A stub:// URI shouldn't have been minted for an ST POU in the
    // first place, but the redirect must still refuse to open a
    // graphical editor for it.
    setProjectPous([pou('Textual', 'st')])
    expect(redirectToGraphicalPou(store, stubUri('Textual'))).toBe(false)
    setProjectPous([pou('ILpou', 'il')])
    expect(redirectToGraphicalPou(store, stubUri('ILpou'))).toBe(false)
  })

  it('opens the graphical editor tab when the POU is LD', () => {
    setProjectPous([pou('Ladder', 'ld', 'program')])
    expect(redirectToGraphicalPou(store, stubUri('Ladder'))).toBe(true)

    const state = store.getState()
    expect(state.editor.type).toBe('plc-graphical')
    expect(state.editor.meta.name).toBe('Ladder')
    const selected = state.tabsActions.getSelectedTab()
    expect(selected).toBe('Ladder')
  })

  it('opens the graphical editor tab when the POU is FBD', () => {
    setProjectPous([pou('Flow', 'fbd', 'function-block')])
    expect(redirectToGraphicalPou(store, stubUri('Flow'))).toBe(true)
    expect(store.getState().editor.meta.name).toBe('Flow')
  })

  it('handles SFC POUs the same way', () => {
    setProjectPous([pou('Chart', 'sfc', 'program')])
    expect(redirectToGraphicalPou(store, stubUri('Chart'))).toBe(true)
    expect(store.getState().editor.meta.name).toBe('Chart')
  })

  it('survives URIs with encoded characters in the POU name', () => {
    setProjectPous([pou('My POU', 'ld')])
    expect(redirectToGraphicalPou(store, stubUri('My POU'))).toBe(true)
  })
})
