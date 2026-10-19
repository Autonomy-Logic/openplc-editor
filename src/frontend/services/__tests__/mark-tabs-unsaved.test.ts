import type { OpenPLCStore } from '../../store'
import { createTestStore } from '../../store/testing'
import { markTabsUnsaved } from '../mark-tabs-unsaved'

let store: OpenPLCStore

const savedOf = (name: string) => store.getState().fileActions.getFile({ name }).file?.saved

beforeEach(() => {
  store = createTestStore()
  for (const name of ['I/O Configurator', 'I/O Mapping']) {
    store.getState().fileActions.addFile({ name, type: 'vendor-screen', filePath: '', cleanState: '{}' })
    store.getState().fileActions.updateFile({ name, saved: true })
  }
})

describe('markTabsUnsaved', () => {
  it('marks every open linked tab unsaved and skips tabs that are not open', () => {
    markTabsUnsaved(store, ['I/O Configurator', 'I/O Mapping', 'Not Open'])

    expect(savedOf('I/O Configurator')).toBe(false)
    expect(savedOf('I/O Mapping')).toBe(false)
    expect(savedOf('Not Open')).toBeUndefined()
  })

  it('marks saved again only the tabs it changed', () => {
    store.getState().fileActions.updateFile({ name: 'I/O Mapping', saved: false })

    const restore = markTabsUnsaved(store, ['I/O Configurator', 'I/O Mapping'])
    restore()

    expect(savedOf('I/O Configurator')).toBe(true)
    expect(savedOf('I/O Mapping')).toBe(false)
  })
})
