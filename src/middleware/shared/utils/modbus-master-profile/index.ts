export {
  createDefaultRemoteDeviceConfig,
  DEFAULT_REMOTE_DEVICE_HOST,
  DEFAULT_REMOTE_DEVICE_PORT,
  firstBoardRtuPort,
} from './default-config'
export { endpointKey } from './endpoint'
export {
  canHostModbusMaster,
  type ModbusMasterBoardInfoLike,
  type ModbusMasterProfile,
  type ModbusMasterRtuPorts,
  type ModbusMasterTransport,
  resolveModbusMasterProfile,
} from './profile'
export { resolveReconnect } from './reconnect'
export {
  findSerialScreenName,
  isRs485PerUartAware,
  isValidRs485Pin,
  LEGACY_RS485_BOARD,
  resolveRs485Pins,
  resolveRtuServerUart,
  RS485_PIN_PATTERN,
  RS485_PINS_KEY,
  type Rs485Board,
  rs485PinOf,
  type RtuServerLike,
  screenHasUartPinMap,
  SERIAL_SCREEN_STATE_KEY,
  type SerialScreenState,
  UART_PIN_MAP_FIELD_TYPE,
  withoutLegacyRs485Pin,
} from './rs485-pins'
