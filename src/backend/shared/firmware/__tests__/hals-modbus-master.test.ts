import { type BoardInfoLike, resolveTargetCapabilities } from '../../../../middleware/shared/utils/target-capabilities'
import halsJson from '../hals.json'

const hals = halsJson as unknown as Record<string, BoardInfoLike>

const mastersOf = (board: string) => {
  const caps = resolveTargetCapabilities(hals[board])
  return { tcp: caps.modbusTcpMaster, rtu: caps.modbusRtuMaster }
}

describe('the built-in targets in hals.json', () => {
  it('give Runtime v4 both Modbus masters', () => {
    expect(mastersOf('OpenPLC Runtime v4')).toEqual({ tcp: true, rtu: true })
  })

  it('give Runtime v3 neither Modbus master', () => {
    expect(mastersOf('OpenPLC Runtime v3')).toEqual({ tcp: false, rtu: false })
  })

  it('give the Simulator both Modbus masters', () => {
    expect(mastersOf('OpenPLC Simulator')).toEqual({ tcp: true, rtu: true })
  })
})
