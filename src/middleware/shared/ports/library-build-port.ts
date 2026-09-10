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
 * The port used to carry a `verifyCompile` primitive that drove the
 * library through avr-gcc against the OpenPLC Simulator board on
 * every build.  It is gone: the build is target-neutral, and running
 * a library is now an explicit action driven from the renderer
 * through `CompilerPort.compileProgram` with a generated harness
 * project (`composeLibraryDebugHarness`).
 *
 * Contract symmetry rule
 * ----------------------
 * Both desktop and web MUST implement every method on this interface
 * with semantically identical behaviour.  When the orchestrator calls
 * `port.readBuildFile(p, 'library.json')`, both platforms return the
 * same content if the project tree carries the same bytes.
 * Differences are confined to *transport* (fs vs HTTP), never to
 * logic — anything that looks like business logic belongs in the
 * shared orchestrator instead.
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

export interface LibraryBuildPort {
  // -------------------------------------------------------------------------
  // Transpile (same signature `CompilerPlatformPort` uses for the
  // program build — declared here too so the orchestrator takes a
  // single port object instead of two.  Each impl is free to delegate
  // to whatever its program-build path uses internally; the contract
  // is just that bytes in match bytes out.)
  //
  // There was a `computeMd5` primitive here as well, hashing
  // `program.st` to key the verification cache.  Both went out with
  // the verification stage.
  // -------------------------------------------------------------------------

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
  // Library resolution (platform-shaped operation whose implementation
  // differs in transport but not in semantics)
  // -------------------------------------------------------------------------

  /**
   * Resolve the project-enabled library refs to their parsed `.stlib`
   * archives.  Includes the bundled IEC standard set automatically —
   * callers don't list it in `projectLibraryRefs`.  Names that can't
   * be resolved come back via `missing` for the orchestrator to fail
   * the build with a clear "Library Manager" message.
   */
  loadLibraryArchives(args: LibraryArchiveLookupArgs): Promise<LibraryArchiveLookup>
}
