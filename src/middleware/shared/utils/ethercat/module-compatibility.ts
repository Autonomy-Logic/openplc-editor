/**
 * Single predicate that decides whether a module from the ESI repository can be
 * plugged into a given modular coupler. Reused by:
 *   - the "Add Module" browser dialog (filters the list the user sees)
 *   - the scan-apply path (treats incompatible scanned idents as unmatched)
 *
 * Current gate: vendor id. A Weidmueller UR20 never accepts a WAGO or Phoenix
 * module. In practice the coupler's own `0xF050` scan will not return modules
 * it does not support — the vendor gate is a belt-and-braces check against a
 * misbehaving stub or an operator picking the wrong file from the repository.
 *
 * ETG.5001 also defines a `<Slots>` block whose entries can further restrict
 * which module idents or classes a given slot accepts, but the vendor-specific
 * encodings of that block vary (plain text in some ESIs, nested `<Class>`
 * sub-elements in WAGO's) and the parser doesn't yet normalise them. Until it
 * does, the Slots-block refinement is intentionally not consulted here so a
 * valid same-vendor module never gets excluded by a parse artefact.
 */

import type { ESIModuleSummary, ESIRepositoryItemLight } from '../../ports/esi-types'

export interface CouplerCompatibility {
  vendorId: string
}

const normaliseHex = (v: string): string => v.toLowerCase().replace(/^0x0*/, '')

export function isModuleCompatibleWithCoupler(
  repoItem: Pick<ESIRepositoryItemLight, 'vendor'>,
  _module: Pick<ESIModuleSummary, 'ident' | 'moduleClass'>,
  coupler: CouplerCompatibility,
): boolean {
  return normaliseHex(repoItem.vendor.id) === normaliseHex(coupler.vendorId)
}
