export { formatAddress, isBitClass, isIecAddress, parseAddress, type ParsedAddress, prefixOf } from './address-space'
export { allocateAddresses, channelKey } from './allocate'
export {
  ethercatConsumerId,
  migrateToRegistry,
  modbusConsumerId,
  recalculateFromLegacy,
  unpinAllocatableChannels,
} from './migrate'
export {
  addConsumer,
  addressOf,
  createRegistry,
  recalculate,
  removeConsumer,
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
