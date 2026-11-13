import { activeKindsFor } from '../migrate'

const NO_PRODUCER = {
  pinMapping: false,
  vppIo: false,
  modbusTcpMaster: false,
  modbusRtuMaster: false,
  ethercat: false,
}

describe('activeKindsFor the Modbus master pair', () => {
  it('activates the remote-device kind on a target that runs only the TCP master', () => {
    expect(activeKindsFor({ ...NO_PRODUCER, modbusTcpMaster: true })).toEqual(new Set(['modbus-tcp-remote']))
  })

  it('activates the remote-device kind on a target that runs only the RTU master', () => {
    expect(activeKindsFor({ ...NO_PRODUCER, modbusRtuMaster: true })).toEqual(new Set(['modbus-tcp-remote']))
  })

  it('activates the remote-device kind once on a target that runs both', () => {
    expect(activeKindsFor({ ...NO_PRODUCER, modbusTcpMaster: true, modbusRtuMaster: true })).toEqual(
      new Set(['modbus-tcp-remote']),
    )
  })

  it('leaves the remote-device kind out on a target that runs neither', () => {
    expect(activeKindsFor(NO_PRODUCER)).toEqual(new Set())
  })
})
