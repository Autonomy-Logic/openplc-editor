import type { OpenPLCStore } from '..'
import { hmiDesignerEntry } from '../slices/hmi-designer'
import { createTestStore } from '../testing'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
  store.getState().hmiActions.create('screen', 'Overview')
})

const source = () => store.getState().project.data.hmi?.screens.find((s) => s.name === 'Overview')?.source ?? ''
const entry = () => hmiDesignerEntry(store.getState(), 'screen', 'Overview')

describe('HMI designer state', () => {
  it('applies edits through the project, marks the screen unsaved, and undoes and redoes them', () => {
    const { hmiDesignerActions } = store.getState()
    const original = source()
    store.getState().fileActions.setAllToSaved()
    hmiDesignerActions.applySource('screen', 'Overview', `${original}(* one *)\n`)
    hmiDesignerActions.applySource('screen', 'Overview', `${original}(* two *)\n`)
    expect(source()).toBe(`${original}(* two *)\n`)
    expect(store.getState().files['Overview'].saved).toBe(false)
    expect(hmiDesignerActions.undo('screen', 'Overview')).toBe(true)
    expect(source()).toBe(`${original}(* one *)\n`)
    expect(hmiDesignerActions.undo('screen', 'Overview')).toBe(true)
    expect(source()).toBe(original)
    expect(hmiDesignerActions.undo('screen', 'Overview')).toBe(false)
    expect(hmiDesignerActions.redo('screen', 'Overview')).toBe(true)
    expect(source()).toBe(`${original}(* one *)\n`)
    expect(hmiDesignerActions.redo('screen', 'Overview')).toBe(true)
    expect(hmiDesignerActions.redo('screen', 'Overview')).toBe(false)
  })

  it('merges typing into one step, ignores no-op and unknown edits', () => {
    const { hmiDesignerActions } = store.getState()
    const original = source()
    hmiDesignerActions.applySource('screen', 'Overview', `${original}a`, { key: 'code', at: 0 })
    hmiDesignerActions.applySource('screen', 'Overview', `${original}ab`, { key: 'code', at: 300 })
    hmiDesignerActions.applySource('screen', 'Overview', `${original}ab`)
    hmiDesignerActions.applySource('screen', 'Missing', 'x')
    expect(entry().history.past).toHaveLength(1)
    expect(hmiDesignerActions.undo('screen', 'Missing')).toBe(false)
    expect(hmiDesignerActions.redo('screen', 'Missing')).toBe(false)
  })

  it('keeps view, device, zoom, selection and the last valid source per element', () => {
    const { hmiDesignerActions } = store.getState()
    expect(entry()).toMatchObject({
      view: 'design',
      device: 'browser',
      zoom: null,
      selection: [],
      lastValidSource: null,
    })
    hmiDesignerActions.setView('screen', 'Overview', 'code')
    hmiDesignerActions.setDevice('screen', 'Overview', 'cyd')
    hmiDesignerActions.setZoom('screen', 'Overview', 1.5)
    hmiDesignerActions.select('screen', 'Overview', ['Title'])
    hmiDesignerActions.setLastValidSource('screen', 'Overview', 'S')
    expect(entry()).toMatchObject({
      view: 'code',
      device: 'cyd',
      zoom: 1.5,
      selection: ['Title'],
      lastValidSource: 'S',
    })
  })

  it('follows a renamed screen, forgets a deleted one and clears on close', async () => {
    const { hmiDesignerActions, hmiActions } = store.getState()
    hmiDesignerActions.setView('screen', 'Overview', 'code')
    await hmiActions.rename('screen', 'Overview', 'Home')
    expect(hmiDesignerEntry(store.getState(), 'screen', 'Home').view).toBe('code')
    hmiActions.delete('screen', 'Home')
    expect(store.getState().hmiDesigner).toEqual({})
    store.getState().hmiActions.create('screen', 'Again')
    store.getState().hmiDesignerActions.setView('screen', 'Again', 'code')
    store.getState().hmiDesignerActions.renameEntry('screen', 'Nothing', 'Else')
    store.getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    expect(store.getState().hmiDesigner).toEqual({})
  })
})
