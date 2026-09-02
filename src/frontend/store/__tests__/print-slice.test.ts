import { createStore } from 'zustand/vanilla'

import { createPrintSlice } from '../slices/print/slice'
import type { PrintSlice } from '../slices/print/types'

function makeStore() {
  return createStore<PrintSlice>()(createPrintSlice)
}

describe('createPrintSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('initializes with an empty selection and default render mode, page policy and page setup', () => {
    expect(store.getState().print).toEqual({
      selectedPouNames: [],
      renderMode: 'normal',
      pagePolicy: 'new-page-per-pou',
      pageSetup: {
        size: 'a4',
        orientation: 'portrait',
        margins: { top: 36, right: 36, bottom: 36, left: 36 },
      },
    })
  })

  describe('togglePou', () => {
    it('adds a POU name not yet selected', () => {
      store.getState().printActions.togglePou('main')
      expect(store.getState().print.selectedPouNames).toEqual(['main'])
    })

    it('removes a POU name already selected', () => {
      store.getState().printActions.togglePou('main')
      store.getState().printActions.togglePou('main')
      expect(store.getState().print.selectedPouNames).toEqual([])
    })

    it('preserves other selected names when toggling one off', () => {
      store.getState().printActions.togglePou('main')
      store.getState().printActions.togglePou('add_ints')
      store.getState().printActions.togglePou('main')
      expect(store.getState().print.selectedPouNames).toEqual(['add_ints'])
    })
  })

  describe('selectAllPous', () => {
    it('replaces the selection with the given names', () => {
      store.getState().printActions.togglePou('stale')
      store.getState().printActions.selectAllPous(['main', 'add_ints'])
      expect(store.getState().print.selectedPouNames).toEqual(['main', 'add_ints'])
    })
  })

  describe('clearPouSelection', () => {
    it('empties the selection without touching render mode or page setup', () => {
      store.getState().printActions.selectAllPous(['main', 'add_ints'])
      store.getState().printActions.setRenderMode('scale-to-fit')

      store.getState().printActions.clearPouSelection()

      const { print } = store.getState()
      expect(print.selectedPouNames).toEqual([])
      expect(print.renderMode).toBe('scale-to-fit')
    })
  })

  describe('setRenderMode', () => {
    it('updates the render mode', () => {
      store.getState().printActions.setRenderMode('scale-to-fit')
      expect(store.getState().print.renderMode).toBe('scale-to-fit')
    })
  })

  describe('setPagePolicy', () => {
    it('updates the page policy', () => {
      store.getState().printActions.setPagePolicy('may-share-page')
      expect(store.getState().print.pagePolicy).toBe('may-share-page')
    })
  })

  describe('setPageSetup', () => {
    it('merges a partial patch over the existing page setup', () => {
      store.getState().printActions.setPageSetup({ orientation: 'landscape' })

      const { pageSetup } = store.getState().print
      expect(pageSetup).toEqual({
        size: 'a4',
        orientation: 'landscape',
        margins: { top: 36, right: 36, bottom: 36, left: 36 },
      })
    })

    it('replaces margins wholesale when patched', () => {
      store.getState().printActions.setPageSetup({ margins: { top: 10, right: 10, bottom: 10, left: 10 } })

      expect(store.getState().print.pageSetup.margins).toEqual({ top: 10, right: 10, bottom: 10, left: 10 })
    })
  })

  describe('resetPrintSelection', () => {
    it('resets the whole slice back to its initial defaults', () => {
      store.getState().printActions.selectAllPous(['main'])
      store.getState().printActions.setRenderMode('scale-to-fit')
      store.getState().printActions.setPagePolicy('may-share-page')
      store.getState().printActions.setPageSetup({ size: 'letter', orientation: 'landscape' })

      store.getState().printActions.resetPrintSelection()

      expect(store.getState().print).toEqual({
        selectedPouNames: [],
        renderMode: 'normal',
        pagePolicy: 'new-page-per-pou',
        pageSetup: {
          size: 'a4',
          orientation: 'portrait',
          margins: { top: 36, right: 36, bottom: 36, left: 36 },
        },
      })
    })
  })
})
