export {
  ALL_ADDRESS_PRODUCERS_ACTIVE,
  ARDUINO_CLI_CAPABILITIES,
  BAREMETAL_S7_BUFFERS,
  DEFAULT_S7_PROFILE,
  RUNTIME_S7_BUFFERS,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  RUNTIME_V4_S7_PROFILE,
  SIMULATOR_CAPABILITIES,
} from './presets'
export { type BoardInfoLike, resolveAddressProducerCapabilities, resolveTargetCapabilities } from './resolve'
export { classifyBoardRuntime, RUNTIME_V3_BOARD_NAME, type RuntimeClassification } from './runtime-kind'
export type {
  AddressProducerCapabilities,
  DebuggerTransport,
  S7TargetProfile,
  ServerCapabilities,
  TargetCapabilities,
} from './types'
