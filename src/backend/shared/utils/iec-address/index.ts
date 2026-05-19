export {
  type AddressPool,
  buildAddressPool,
  type BuildPoolOptions,
  type ClaimedAddress,
  type ConflictReport,
  isAddressClaimed,
  listClaims,
  nextFreeAddress,
  type PoolInputs,
  type PoolPinMappingInput,
  type PoolRemoteDeviceInput,
  type PoolVppIoInput,
  type SourceKind,
  type SourceRef,
} from './address-pool'
export {
  type AliasEntry,
  aliasForAddress,
  type AliasRegistry,
  buildAliasRegistry,
  isAliasNameAvailable,
  resolveAlias,
} from './alias-registry'
export {
  type SyncableVariable,
  syncMadeChanges,
  type SyncReport,
  type SyncResult,
  syncVariableAliases,
} from './sync-variable-aliases'
