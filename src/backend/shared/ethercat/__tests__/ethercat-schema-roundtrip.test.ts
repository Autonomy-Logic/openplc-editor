/**
 * A remote-device file is reloaded through `PLCRemoteDeviceSchema`, which drops every key it
 * does not declare. A station built from real vendor ESIs must come back unchanged, or the
 * generator loses InitCmds, slot rules or slot-dependent indices after a save and reopen.
 */

import { PLCRemoteDeviceSchema } from '@root/backend/shared/types/PLC/open-plc'

import { ur20ModularProject } from './fixtures/ur20-modular-project'

describe('EtherCAT remote device schema round trip', () => {
  test('a UR20 station built from the vendor ESIs survives save and reload unchanged', () => {
    const saved: unknown = JSON.parse(JSON.stringify(ur20ModularProject[0]))
    const reloaded = PLCRemoteDeviceSchema.safeParse(saved)
    expect(reloaded.success).toBe(true)
    if (!reloaded.success) return
    expect(reloaded.data).toEqual(saved)
  })

  test('the fixture carries the fields the schema must keep', () => {
    const device = ur20ModularProject[0]?.ethercatConfig?.devices[0]
    expect(device?.esiInitCmdSdos?.length).toBeGreaterThan(0)
    expect(device?.slotsSpec?.downloadModuleIdentList).toBe(true)
    expect(device?.modulePdoGroups?.length).toBe(2)
    const module = device?.modules?.[0]
    expect(module).toMatchObject({ moduleClass: 'Di', modulePdoGroup: 1 })
    expect(module?.txPdos?.[0]?.dependOnSlot).toBe(true)
    expect(module?.sdoConfigurations?.[0]).toMatchObject({ dependOnSlot: true, transition: 'PS' })
  })
})
