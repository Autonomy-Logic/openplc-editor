/**
 * The pre-build gate predicts which EtherDOG features a project needs; the generator is what
 * actually uses them. Every byte payload or Complete Access write in the generated bus
 * configuration must be predicted, or a project would pass the gate and fail on the bus.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import { requiredRuntimeFeatures } from '@root/middleware/shared/utils/build-gate/runtime-capability-gate'

import { generateEtherdogConfigs } from '../generate-ethercat-config'
import { deltaMultiModeProject } from './fixtures/delta-multimode-project'
import { ur20ModularProject } from './fixtures/ur20-modular-project'

type Sdo = { value_bytes?: string; complete_access?: boolean }

const usedFeatures = (project: PLCRemoteDevice[]): string[] => {
  const result = generateEtherdogConfigs(project)
  if (result === null) throw new Error('generator returned null')
  const parsed: unknown = JSON.parse(result.busconfig)
  const used = new Set<string>()
  const roots = Array.isArray(parsed) ? parsed : []
  for (const root of roots) {
    const slaves: Array<{ sdo_configurations?: Sdo[] }> = root?.config?.slaves ?? []
    for (const slave of slaves) {
      for (const sdo of slave.sdo_configurations ?? []) {
        if (sdo.value_bytes !== undefined) used.add('ethercat.sdo_byte_string')
        if (sdo.complete_access === true) used.add('ethercat.sdo_complete_access')
      }
    }
  }
  return [...used].sort()
}

describe.each([
  ['Delta ASDA-A2-E', deltaMultiModeProject],
  ['UR20 station', ur20ModularProject],
])('%s', (_name, project) => {
  test('the gate predicts every feature the generated configuration uses', () => {
    const predicted = requiredRuntimeFeatures(project)
    for (const feature of usedFeatures(project)) expect(predicted).toContain(feature)
  })
})
