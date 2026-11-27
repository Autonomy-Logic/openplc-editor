import type { TargetCapabilities } from './types'

/** True when the target runs a Modbus master on either transport, which makes remote-device I/O an address producer. */
export function runsModbusMaster(caps: Pick<TargetCapabilities, 'modbusTcpMaster' | 'modbusRtuMaster'>): boolean {
  return caps.modbusTcpMaster || caps.modbusRtuMaster
}
