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
