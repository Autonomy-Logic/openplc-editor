import { UR20_16DI_16DO } from '../../../../__fixtures__/device-editor-datapoints/ur20-16di-16do'
import { toDeviceSetupRecord } from '../device-setup'

describe('toDeviceSetupRecord', () => {
  it('numbers modules by bus position and keeps guid, name and type', () => {
    expect(toDeviceSetupRecord(UR20_16DI_16DO.deviceSetup).modules).toEqual([
      { guid: 'ff97f8f1-d407-468d-d498-395ace2847f8', instanceName: 'UR20_16DI_P_1', typeId: '00049fc2', slot: 1 },
      { guid: 'b1a5b668-9bb2-4ecc-e0ae-ee660206e77f', instanceName: 'UR20_16DO_P_1', typeId: '0103afd0', slot: 2 },
    ])
  })

  it('leaves the system bus out', () => {
    expect(toDeviceSetupRecord(UR20_16DI_16DO.deviceSetup).modules.map((module) => module.typeId)).not.toContain(
      '01000000',
    )
  })
})
