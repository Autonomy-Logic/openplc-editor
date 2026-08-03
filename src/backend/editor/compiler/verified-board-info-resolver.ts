/**
 * Signature-verifying wrapper around the shared `BoardInfoResolver`.
 *
 * WHY THIS EXISTS: the VPP package decides everything the compiler links —
 * which precompiled archive comes in (`hal.precompiledLibrary`), which HAL
 * `.cpp` compiles (`hal.source`), which license-store backends get injected
 * into the sketch (`hal.licenseStore`), and every compiler/linker flag
 * (`hal.compilerFlags`). Signature verification used to run only on import
 * and in the open-project sweep, so anything that edited an already-installed
 * package on disk — dropping the closed license-core `.a` and supplying its
 * own `updateInput/OutputBuffers` symbols, say — compiled and flashed clean.
 * That is a licence bypass, not a build error.
 *
 * The fix is to make the build path itself the trust boundary: every board
 * resolution that feeds the compiler goes through this subclass, and a board
 * whose package does not verify against `TRUSTED_PACKAGE_KEYS` fails the
 * build. Fails closed — an unreadable package, a path we can't stat, or a
 * throw from the verifier all count as "not trusted".
 *
 * Reuses `verifyPackageSignature` verbatim (same Ed25519 + full file-hash
 * manifest check the import path uses); no new crypto lives here.
 *
 * COST MODEL: verification hashes every byte of a package, so we verify ONLY
 * the package that provides the requested board, not the whole installed set,
 * and memoise the verdict per package path for the lifetime of the resolver
 * instance. A build resolves the target board a handful of times across a
 * handful of resolver instances, so the real cost is a few sha256 passes over
 * one package (single-digit ms for a source VPP, tens of ms for one shipping
 * a multi-MB prebuilt archive) against a compile measured in tens of seconds.
 * The trade-off this accepts: a *different* tampered package sitting in the
 * registry does not block a build that doesn't use it. That case is already
 * covered by `PackageManagerModule.verifyInstalledSignatures`, which sweeps
 * every installed package at project open and uninstalls the bad ones.
 */

import {
  type BoardBuildInfo,
  BoardInfoResolver,
  type BoardInfoResolverConfig,
} from '../../shared/hardware/board-info-resolver'
import { TRUSTED_PACKAGE_KEYS } from '../../shared/utils/vpp/trusted-keys'
import { type TrustedKeys, verifyPackageSignature } from '../../shared/utils/vpp/verify-package-signature'

/**
 * User-facing refusal text. Shared by the thrown error and the compile
 * entrypoints that surface the failure on the console port, so the message the
 * user reads is the same wherever the check trips.
 */
export function vppSignatureRefusalMessage(boardName: string, reason: string): string {
  return (
    `Refusing to build for "${boardName}": the VPP package providing this board failed signature ` +
    `verification (${reason}). This package decides which HAL sources, prebuilt objects and ` +
    `compiler flags go into the firmware, so it is never compiled unverified. Re-install the ` +
    `package from a trusted source and try again.`
  )
}

/** Thrown by `VerifiedBoardInfoResolver.resolve` when the board's package is not trusted. */
export class VppPackageSignatureError extends Error {
  readonly boardName: string
  /** Short reason from `verifyPackageSignature` (or why we couldn't run it). */
  readonly reason: string

  constructor(boardName: string, reason: string) {
    super(vppSignatureRefusalMessage(boardName, reason))
    this.name = 'VppPackageSignatureError'
    this.boardName = boardName
    this.reason = reason
  }
}

export class VerifiedBoardInfoResolver extends BoardInfoResolver {
  readonly #trustedKeys: TrustedKeys
  /** packagePath -> rejection reason, or null when verified. Memoised per instance. */
  readonly #verdicts = new Map<string, string | null>()

  constructor(config: BoardInfoResolverConfig, trustedKeys: TrustedKeys = TRUSTED_PACKAGE_KEYS) {
    super(config)
    this.#trustedKeys = trustedKeys
  }

  /**
   * Same contract as the base resolver, plus: a board coming from a VPP
   * package whose signature does not verify raises `VppPackageSignatureError`
   * instead of returning build info. Boards from `hals.json` are unaffected —
   * they ship inside the app bundle and have no package to verify.
   */
  override resolve(boardName: string): BoardBuildInfo {
    const info = super.resolve(boardName)
    const reason = this.#rejectionReason(info)
    if (reason !== null) {
      throw new VppPackageSignatureError(boardName, reason)
    }
    return info
  }

  /**
   * Non-throwing probe for callers that want to report the signature failure
   * themselves with their own logging/abort path (the compile entrypoints do,
   * because `resolveBoardSelection` collapses every resolver throw into a
   * generic "board not found" message).
   *
   * Returns the rejection reason, or `null` when the board is trusted, is not
   * VPP-provided, or does not resolve at all — an unresolvable board is the
   * caller's own error to report, not a signature failure.
   */
  verifyBoardPackage(boardName: string): string | null {
    let info: BoardBuildInfo
    try {
      info = super.resolve(boardName)
    } catch {
      return null
    }
    return this.#rejectionReason(info)
  }

  #rejectionReason(info: BoardBuildInfo): string | null {
    if (info.source !== 'vpp') return null

    const packagePath = info.vppPackagePath
    if (typeof packagePath !== 'string' || packagePath.length === 0) {
      return 'the installed package has no recorded path on disk'
    }

    const memoised = this.#verdicts.get(packagePath)
    if (memoised !== undefined) return memoised

    let reason: string | null
    try {
      const verification = verifyPackageSignature(packagePath, this.#trustedKeys)
      reason = verification.valid ? null : (verification.error ?? 'invalid signature')
    } catch (err) {
      // verifyPackageSignature is defensive, but a stat/permission failure on
      // the package root can still escape. Treat it as untrusted.
      reason = err instanceof Error ? err.message : String(err)
    }
    this.#verdicts.set(packagePath, reason)
    return reason
  }
}
