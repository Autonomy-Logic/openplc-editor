import { deviceConfigurationSchema } from '@root/backend/shared/types/PLC/devices'
import type { OrchestratorInfo } from '@root/middleware/shared/ports/orchestrator-port'

import { findProjectTargetDevice, toProjectTargetDevice, toSelectedDevice } from '../project-target-device'

const vpp = { packageId: 'acme.io', version: '1.2.0', contentHash: 'abc' }

const orchestrators = [
  {
    id: 'edge-1',
    agentId: 'agent-1',
    name: 'shop-floor-01',
    devices: [
      { id: 'vplc-1', name: 'mixer', status: 'online', active: true, backplaneAccess: true, vpp },
      { id: 'vplc-2', name: 'conveyor', status: 'offline', active: false },
    ],
  },
] as OrchestratorInfo[]

const target = { orchestratorId: 'edge-1', deviceId: 'vplc-1', deviceName: 'mixer' }

describe('findProjectTargetDevice', () => {
  it('restores the recorded vPLC with its live binding from the listing', () => {
    expect(findProjectTargetDevice(target, orchestrators)).toEqual({
      orchestratorId: 'edge-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'vplc-1',
      deviceName: 'mixer',
      backplaneAccess: true,
      vpp,
    })
  })

  it('takes the current name from the listing, not the recorded one', () => {
    expect(findProjectTargetDevice({ ...target, deviceName: 'old-name' }, orchestrators)?.deviceName).toBe('mixer')
  })

  it('returns null when the vPLC is no longer listed for this user', () => {
    expect(findProjectTargetDevice({ ...target, deviceId: 'gone' }, orchestrators)).toBeNull()
    expect(findProjectTargetDevice({ ...target, orchestratorId: 'other-edge' }, orchestrators)).toBeNull()
    expect(findProjectTargetDevice(target, [])).toBeNull()
  })

  it('returns null for an inactive vPLC, which cannot be selected by hand either', () => {
    expect(findProjectTargetDevice({ ...target, deviceId: 'vplc-2' }, orchestrators)).toBeNull()
  })
})

describe('toSelectedDevice / toProjectTargetDevice', () => {
  it('keeps an absent binding absent', () => {
    const selection = toSelectedDevice('edge-1', 'agent-1', {
      id: 'vplc-3',
      name: 'legacy',
      status: 'online',
      active: true,
    })
    expect('backplaneAccess' in selection).toBe(false)
    expect('vpp' in selection).toBe(false)
  })

  it('records identity only, never the binding', () => {
    const selection = toSelectedDevice('edge-1', 'agent-1', orchestrators[0].devices[0])
    expect(toProjectTargetDevice(selection)).toEqual(target)
  })
})

describe('devices/configuration.json targetDevice', () => {
  it('round-trips through the schema', () => {
    const parsed = deviceConfigurationSchema.parse({ deviceBoard: 'OpenPLC Runtime v4', targetDevice: target })
    expect(parsed.targetDevice).toEqual(target)
  })

  it('stays optional, so a project saved before it still validates', () => {
    const parsed = deviceConfigurationSchema.parse({ deviceBoard: 'OpenPLC Runtime v4' })
    expect(parsed.targetDevice).toBeUndefined()
  })
})
