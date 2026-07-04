export { formatAddress, isBitClass, isIecAddress, parseAddress, type ParsedAddress, prefixOf } from './address-space'
export { allocateAddresses, channelKey } from './allocate'
export {
  ethercatConsumerId,
  ethercatMemoryKey,
  migrateToRegistry,
  modbusConsumerId,
  modbusMemoryKey,
  recalculateFromLegacy,
  unpinAllocatableChannels,
  vppMemoryKey,
} from './migrate'
export {
  addConsumer,
  addressOf,
  createRegistry,
  recalculate,
  removeConsumer,
  restoreAliasesFromMemory,
  setAlias,
  updateConsumer,
} from './registry'
export { buildAliasIndex, isLiteralLocation, resolveLocation } from './resolve'
export type {
  AddressClass,
  AddressConflict,
  AllocateOptions,
  AllocationResult,
  ConsumerKind,
  IecAddressRegistry,
  IecDirection,
  IecSize,
  RegistryChannel,
  RegistryConsumer,
  SetAliasResult,
} from './types'
