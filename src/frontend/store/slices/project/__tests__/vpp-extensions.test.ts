import { createTestStore } from '@root/frontend/store/testing'

describe('projectActions.vppExtensions', () => {
  it('round-trips opaque data under (packageId, screenId)', () => {
    const store = createTestStore()
    const packageId = 'com.weidmuller.ucontrol'
    const screenId = 'data-hub'
    expect(store.getState().projectActions.getVppExtension(packageId, screenId)).toBeUndefined()

    const payload = { exports: [{ qualifier: 'Program0.pump_speed', direction: 'RW' as const }] }
    store.getState().projectActions.setVppExtension(packageId, screenId, payload)
    expect(store.getState().projectActions.getVppExtension(packageId, screenId)).toEqual(payload)
    expect(store.getState().project.data.vppExtensions).toEqual({ [packageId]: { [screenId]: payload } })
  })

  it('isolates entries by packageId and by screenId', () => {
    const store = createTestStore()
    store.getState().projectActions.setVppExtension('vendor.a', 'screen-x', { a: 1 })
    store.getState().projectActions.setVppExtension('vendor.a', 'screen-y', { a: 2 })
    store.getState().projectActions.setVppExtension('vendor.b', 'screen-x', { b: 1 })
    const ext = store.getState().project.data.vppExtensions
    expect(ext).toEqual({
      'vendor.a': { 'screen-x': { a: 1 }, 'screen-y': { a: 2 } },
      'vendor.b': { 'screen-x': { b: 1 } },
    })
  })

  it('overwrites prior value for the same key', () => {
    const store = createTestStore()
    store.getState().projectActions.setVppExtension('vendor.a', 'screen-x', { a: 1 })
    store.getState().projectActions.setVppExtension('vendor.a', 'screen-x', { a: 2 })
    expect(store.getState().projectActions.getVppExtension('vendor.a', 'screen-x')).toEqual({ a: 2 })
  })
})
