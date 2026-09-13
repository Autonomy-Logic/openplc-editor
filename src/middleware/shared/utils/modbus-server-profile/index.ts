export {
  DEFAULT_SERIAL_BAUD,
  isDefaultPort,
  readSerialBaudState,
  resolveDefaultPortBaud,
  resolveRs485Pin,
  resolveRtuPort,
  resolveServerBaud,
  type SerialBaudScreenState,
} from './baud'
export { type ModbusBoardInfoLike, resolveModbusServerProfile } from './resolve'
export type { ModbusSegment, ModbusSegmentCounts, ModbusServerProfile, ModbusServerTransport } from './types'
