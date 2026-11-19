import { desktopPackageTrustMechanisms } from './mechanisms'
import { createPackageTrustAnchor } from './package-trust-anchor'
import type { PackageTrustAnchor } from './types'

export { desktopPackageTrustMechanisms } from './mechanisms'
export type { CreatePackageTrustAnchor, PackageSnapshot, PackageTrustAnchor, PackageTrustMechanisms } from './types'

/** The trust anchor of this build: the generated module on the desktop mechanisms. */
export const desktopPackageTrustAnchor: PackageTrustAnchor = createPackageTrustAnchor(desktopPackageTrustMechanisms)
