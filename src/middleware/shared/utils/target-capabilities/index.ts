export {
  ALL_ADDRESS_PRODUCERS_ACTIVE,
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from './presets'
export { type BoardInfoLike, resolveAddressProducerCapabilities, resolveTargetCapabilities } from './resolve'
export { classifyBoardRuntime, RUNTIME_V3_BOARD_NAME, type RuntimeClassification } from './runtime-kind'
export type { AddressProducerCapabilities, DebuggerTransport, ServerCapabilities, TargetCapabilities } from './types'
