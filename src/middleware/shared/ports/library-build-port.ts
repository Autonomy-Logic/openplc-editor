// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Library build port — the **entire** platform-specific surface of a
 * `.stlib` compilation.  Every byte of orchestration / decision /
 * formatting / hashing logic lives in the shared
 * `runLibraryBuildPipeline` orchestrator; this port owns only the
 * primitives the orchestrator cannot perform itself because they
 * cross the platform boundary (filesystem ↔ HTTP, etc.).
 *
 * Contract symmetry rule
 * ----------------------
 * Both desktop and web MUST implement every method on this interface
 * with semantically identical behaviour.  When the orchestrator calls
 * `port.readBuildFile(p, 'build/.verify-cache-library.json')`, both
 * platforms return the same content if the project tree carries the
 * same bytes.  Differences are confined to *transport* (fs vs HTTP),
 * never to logic — anything that looks like business logic belongs in
 * the shared orchestrator instead.
 *
 * Web safety reminder
 * -------------------
 * Web's save endpoint is delete-by-omission: a save with a missing
 * file deletes it on S3.  Any port impl method that touches the
 * project tree MUST load the current snapshot first, mutate it, and
 * save the full snapshot — never POST a partial state.  See the
 * `LibraryBuildPort` implementation guide alongside the web impl for
 * the exact pattern.
 */

import type { TranspileToStArgs, TranspileToStResult } from './compiler-platform-port'

/**
 * Outcome of an attempted verification compile against the OpenPLC
 * Simulator board.  Verification is advisory: a `success: false`
 * surfaces as a warning on the build result, never as a fatal error
 * (the `.stlib` still ships).  See `runLibraryBuildPipeline` for the
 * cache + skip-on-md5-match flow that wraps this.
 */
export interface LibraryVerificationResult {
  success: boolean
  /** Human-readable summary of the failure, surfaced as a console
   *  warning when `success` is false.  Undefined on success. */
  message?: string
}

/**
 * Library-enabled archives the project pulls in for the strucpp
 * compile.  `archives` carries the bundled IEC standard set PLUS any
 * user-installed `.stlib`s the project's `data.libraries` list
 * enables.  `missing` lists names the project enables but no archive
 * could be resolved for; the orchestrator fails the build with a
 * "Library Manager" message when `missing` is non-empty.
 */
export interface LibraryArchiveLookup {
  archives: unknown[]
  missing: string[]
}

export interface LibraryArchiveLookupArgs {
  projectLibraryRefs: ReadonlyArray<{ name: string; version: string }>
}

export interface VerifyCompileArgs {
  /** Project root path on the host platform.  Same value the build
   *  orchestrator received; the port impl knows how to interpret it. */
  projectPath: string
  /**
   * Verification-pass project data — Python POUs already lowered to
   * no-op stubs (the AVR simulator has no Python interpreter).  The
   * orchestrator preprocesses this separately from the build pass
   * and hands the result through.
   *
   * Typed as `unknown` on purpose: the architecture rule forbids the
   * port from importing `backend/shared` types.  The orchestrator
   * lives in `backend/shared` and produces shape-correct data; the
   * port impl casts to its platform's expected shape (port-shape on
   * web before invoking `runCompilePipeline`, schema-shape on editor
   * before threading into the IPC envelope).
   */
  verifyProjectData: unknown
  /** Caller log callback.  Every line the inner compile emits is
   *  forwarded here; the orchestrator prefixes them with `[verify]`
   *  before forwarding to its own caller. */
  emit: (message: string, level: 'info' | 'warning' | 'error') => void
}

export interface LibraryBuildPort {
  // -------------------------------------------------------------------------
  // Cryptography + transpile (same signatures `CompilerPlatformPort`
  // uses for the program build — duplicated here intentionally so the
  // orchestrator takes a single port object instead of two.  Each
  // impl is free to delegate to whatever its program-build path uses
  // internally; the contract is just that bytes in match bytes out.)
  // -------------------------------------------------------------------------

  /** MD5 hex digest.  Editor wires it to Node's `crypto`; web wires
   *  it to `spark-md5`.  Both byte-identical. */
  computeMd5(input: string): Promise<string>

  /**
   * Transpile the project IR directly to ST via the in-process
   * JSON transpiler (`st-transpiler`).  Both editor and
   * web adapters project their port-shape input into the
   * transpiler's minimal `TranspileProject` IR.  The `log`
   * callback is the orchestrator's emit channel.
   */
  transpileToSt(
    args: TranspileToStArgs,
    log: (message: string, level: 'info' | 'warning' | 'error') => void,
  ): Promise<TranspileToStResult>

  // -------------------------------------------------------------------------
  // Generic file IO over the project tree
  // -------------------------------------------------------------------------

  /**
   * Read a project-relative file.  Returns `null` when the file does
   * not exist (the orchestrator treats null as a cache miss / first-run
   * sentinel — never throws on missing files).  Throws only for genuine
   * IO errors the orchestrator surfaces as build failures.
   */
  readBuildFile(projectPath: string, relPath: string): Promise<string | null>

  /**
   * Write a project-relative file, creating parent directories as
   * needed.  Implementations MUST preserve every other file in the
   * project tree — see the safety reminder at the top of this file.
   */
  writeBuildFile(projectPath: string, relPath: string, content: string): Promise<void>

  /**
   * Recursively remove a project-relative subtree.  No-op when the
   * subtree doesn't exist.  Implementations MUST scope deletion to
   * the named subtree — wiping anything outside it is a contract
   * violation (the orchestrator relies on this guarantee when it
   * clears `build/library/` between runs).
   */
  deleteBuildSubtree(projectPath: string, relPath: string): Promise<void>

  // -------------------------------------------------------------------------
  // Library-resolution and verification (platform-shaped operations
  // whose implementations differ in transport but not in semantics)
  // -------------------------------------------------------------------------

  /**
   * Resolve the project-enabled library refs to their parsed `.stlib`
   * archives.  Includes the bundled IEC standard set automatically —
   * callers don't list it in `projectLibraryRefs`.  Names that can't
   * be resolved come back via `missing` for the orchestrator to fail
   * the build with a clear "Library Manager" message.
   */
  loadLibraryArchives(args: LibraryArchiveLookupArgs): Promise<LibraryArchiveLookup>

  /**
   * Run a verification compile of `verifyProjectData` against the
   * OpenPLC Simulator board.  Both platform impls internally drive
   * the shared `runCompilePipeline` — the only thing they own is the
   * platform-specific arg assembly (board entry, hals data, firmware
   * skeleton) and the transport.  Failures are advisory: the
   * orchestrator surfaces them as a warning on the build result,
   * never as a fatal error.
   */
  verifyCompile(args: VerifyCompileArgs): Promise<LibraryVerificationResult>
}
