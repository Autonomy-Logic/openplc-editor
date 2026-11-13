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
