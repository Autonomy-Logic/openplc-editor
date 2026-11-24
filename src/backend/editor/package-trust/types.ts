/** Positional: [true, verified packageId, verified version] when every check passed, else [false, refusal reason]. */
export type TrustVerdict = readonly [true, string, string] | readonly [false, string]

/** Verifies the package in packageDir at import (atImport true) or at use (false). */
export type VerifyTrustedPackage = (packageDir: string, atImport: boolean) => TrustVerdict

/** The refusal of every check of the generated trust module and of its call sites; it names no check. */
export const TRUST_REFUSAL = 'Package trust check failed'
