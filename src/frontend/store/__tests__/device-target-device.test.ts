import { createTestStore } from '../testing'

const target = { orchestratorId: 'edge-1', deviceId: 'vplc-1', deviceName: 'mixer' }

describe('deviceActions.setTargetDevice', () => {
  it('records the vPLC on the project configuration and marks it for saving', () => {
    const store = createTestStore()
    store.getState().deviceActions.setTargetDevice(target)

    expect(store.getState().deviceDefinitions.configuration.targetDevice).toEqual(target)
    expect(store.getState().deviceUpdated.updated).toBe(true)
  })

  it('is a no-op when the same vPLC is picked again', () => {
    const store = createTestStore()
    store.getState().deviceActions.setTargetDevice(target)
    store.getState().deviceActions.resetDeviceUpdated()
    const before = store.getState().deviceDefinitions.configuration

    store.getState().deviceActions.setTargetDevice({ ...target })

    expect(store.getState().deviceDefinitions.configuration).toBe(before)
    expect(store.getState().deviceUpdated.updated).toBe(false)
  })

  it('removes the field when cleared, and clearing nothing marks nothing', () => {
    const store = createTestStore()
    store.getState().deviceActions.setTargetDevice(null)
    expect(store.getState().deviceUpdated.updated).toBe(false)

    store.getState().deviceActions.setTargetDevice(target)
    store.getState().deviceActions.setTargetDevice(null)
    expect('targetDevice' in store.getState().deviceDefinitions.configuration).toBe(false)
  })

  it('survives a project load: setDeviceDefinitions keeps the recorded vPLC', () => {
    const store = createTestStore()
    store.getState().deviceActions.setDeviceDefinitions({
      configuration: { deviceBoard: 'OpenPLC Runtime v4', communicationPort: '', targetDevice: target },
    })
    expect(store.getState().deviceDefinitions.configuration.targetDevice).toEqual(target)
  })

  it('is not kept across projects: closing the project clears it', () => {
    const store = createTestStore()
    store.getState().deviceActions.setTargetDevice(target)
    store.getState().deviceActions.clearDeviceDefinitions()
    expect(store.getState().deviceDefinitions.configuration.targetDevice).toBeUndefined()
  })
})
