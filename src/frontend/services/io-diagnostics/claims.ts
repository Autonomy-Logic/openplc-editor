/**
 * Every address a producer took, and which producer took it.
 *
 * Separate from the rest of the snapshot because a file that builds an address
 * pool must resolve capabilities the PRODUCER way or not at all (DOPE-615, C1),
 * and the snapshot also needs the strict resolver for servers. Keeping the pool
 * here, receiving its capabilities like `compute-io-image.ts` does, means the
 * two resolvers can never be confused for one another.
 */

import type { ClaimedAddress, PoolRemoteDeviceInput, SourceKind } from '../../../middleware/shared/utils/iec-address'
import { buildAddressPool, listClaims } from '../../../middleware/shared/utils/iec-address'
import { parseAddress, prefixOf } from '../../../middleware/shared/utils/iec-address/registry'
import type { AddressProducerCapabilities } from '../../../middleware/shared/utils/target-capabilities'

export interface IoDiagnosticsClaim {
  address: string
  prefix: string
  kind: SourceKind
  /** Human-readable pointer back to the producer. */
  ref: string
  alias: string
}

export interface ProducerClaimsInput {
  capabilities: AddressProducerCapabilities
  pins: Parameters<typeof buildAddressPool>[0]['pinMapping']
  vendorIoMapping: Parameters<typeof buildAddressPool>[0]['vendorIoMapping']
  remoteDevices: PoolRemoteDeviceInput[] | undefined
}

export function collectProducerClaims(input: ProducerClaimsInput) {
  const pool = buildAddressPool(
    {
      ...(input.pins ? { pinMapping: input.pins } : {}),
      ...(input.vendorIoMapping ? { vendorIoMapping: input.vendorIoMapping } : {}),
      ...(input.remoteDevices ? { remoteDevices: input.remoteDevices } : {}),
    },
    input.capabilities,
  )
  return { claims: listClaims(pool).map(describeClaim), conflicts: pool.conflicts }
}

/** `'%QX0.0'` → `'%QX'`. Through the parser rather than a slice, so a string
 *  that is not an address reads as one instead of as a prefix. */
export function prefixForAddress(address: string): string | null {
  const parsed = parseAddress(address)
  return parsed ? prefixOf(parsed.cls) : null
}

function describeClaim(claim: ClaimedAddress): IoDiagnosticsClaim {
  return {
    address: claim.address,
    prefix: prefixForAddress(claim.address) ?? '',
    kind: claim.source.kind,
    ref: claim.source.ref,
    alias: claim.alias ?? '',
  }
}
