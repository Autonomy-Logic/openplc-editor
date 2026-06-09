// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Desktop implementation of {@link LibraryBuildPort}.
 *
 * Owns ONLY the platform-specific primitives the shared
 * `runLibraryBuildPipeline` cannot perform itself:
 *
 *   - MD5 hashing (Node `crypto`)
 *   - ST transpilation through either backend, selected via
 *     `isNewTranspilerEnabled()` — the in-process JSON-fed
 *     transpiler when on, the bundled `xml2st` subprocess (default)
 *     when off
 *   - read / write / delete project files on the local disk
 *   - resolve library-name → `.stlib` archive via the main-process bridge
 *   - drive a verification compile through the editor's existing
 *     `compileProgram` flow (which already routes through the
 *     shared `runCompilePipeline`)
 *
 * No business logic lives here.  The orchestrator owns the build
 * sequence, cache decisions, error formatting, and the stable
 * `build/library/*` file names — every byte of that surface is
 * shared with the web port impl.
 */

import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { assertPathContained } from '@root/backend/editor/utils/path-containment'
import { isNewTranspilerEnabled } from '@root/backend/editor/utils/transpiler-mode'
import {
  fromSchemaShape,
  type SchemaProjectData,
  transpileToSt as runJsonTranspiler,
} from '@root/backend/shared/transpilers/st-transpiler'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import type { TranspileToStArgs, TranspileToStResult } from '@root/middleware/shared/ports/compiler-platform-port'
import type { LibraryBuildPort } from '@root/middleware/shared/ports/library-build-port'

/**
 * Subset of the desktop CompilerModule that the port leans on.
 * Injected (not imported as a module reference) so this file's
 * surface stays narrow + unit-testable.
 */
export interface DesktopLibraryBuildPortDeps {
  /**
   * Spawn the bundled `xml2st` binary on the given input path.  The
   * binary writes `program.st` next to its input; the port reads it
   * back from disk after the spawn resolves.  Matches the existing
   * `CompilerModule.handleTranspileXMLtoST` signature so the adapter
   * can pass it through verbatim without a wrapper.
   *
   * Only invoked by the legacy transpile path (selected when
   * `isNewTranspilerEnabled()` returns false).
   */
  transpileXmlToSt(
    xmlPath: string,
    log: (chunk: Buffer | string, level?: 'info' | 'error') => void,
    extraArgs: readonly string[],
  ): Promise<unknown>

  /**
   * Resolve the names of project-enabled libraries to their parsed
   * `.stlib` archives.  Bundled IEC standard set is included
   * automatically.  Names that can't be resolved come back under
   * `missing` — orchestrator fails the build with a Library-Manager-
   * pointing message before any heavy step runs.
   */
  loadEnabledArchives(enabledNames: string[]): { archives: unknown[]; missing: string[] }

  /**
   * Run a verification compile against the OpenPLC Simulator board.
   * Wraps `CompilerModule.runVerificationCompile` so the port stays
   * decoupled from the compiler module's full surface.  Failures
   * here are advisory — caller surfaces them as warnings, never as
   * a fatal build error.
   */
  runVerificationCompile(args: {
    projectPath: string
    verifyProjectData: unknown
    emit: (message: string, level?: 'info' | 'warning' | 'error') => void
  }): Promise<{ success: boolean; message?: string }>
}

export function createDesktopLibraryBuildPort(deps: DesktopLibraryBuildPortDeps): LibraryBuildPort {
  return {
    computeMd5(input: string): Promise<string> {
      // Web's port impl computes the same digest via `spark-md5`.
      // The orchestrator's verification cache keys off this value,
      // so both platforms MUST agree byte-for-byte.
      return Promise.resolve(createHash('md5').update(input).digest('hex'))
    },

    async transpileToSt(
      args: TranspileToStArgs,
      log: (message: string, level: 'info' | 'warning' | 'error') => void,
    ): Promise<TranspileToStResult> {
      if (isNewTranspilerEnabled()) {
        try {
          // Editor library builds receive the same schema-shape
          // project data as `compileProgram` (see `transpileToSt` on
          // `editor-compiler-platform-port` for the IPC-shape note).
          // The double cast bridges the port's declared port-shape type
          // and the actual schema-shape payload at the boundary.
          const ir = fromSchemaShape(args.projectData as unknown as SchemaProjectData)
          const result = runJsonTranspiler(ir)
          if (result.programSt === null || result.errors.length > 0) {
            const message = result.errors.join('\n') || 'transpile-from-json failed'
            log(message, 'error')
            return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
          }
          for (const warning of result.warnings) {
            log(warning, 'info')
          }
          return { ok: true, programSt: result.programSt }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`transpile-from-json failed: ${message}`, 'error')
          return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
        }
      }

      // Legacy path: serialise the project to PLCOpen XML and spawn
      // the bundled `xml2st` binary on a temp file. Lifts the
      // pre-Phase-2 implementation byte-for-byte; the only delta is
      // the leading `XmlGenerator` call because the shared pipeline
      // no longer hands the port a pre-built XML payload.
      const xmlResult = XmlGenerator(args.projectData as never, 'old-editor')
      if (!xmlResult.ok || !xmlResult.data) {
        log(`XML generation failed: ${xmlResult.message}`, 'error')
        return { ok: false, errors: [{ message: xmlResult.message, line: 0, column: 0, severity: 'error' }] }
      }
      // xml2st takes a file path on stdin, so materialise the
      // in-memory XML to a unique temp file before spawning.
      // Lives in `os.tmpdir()` because the user-visible `plc.xml`
      // is written separately by the orchestrator via
      // writeBuildFile — the intermediate here exists only for the
      // subprocess.
      const sessionDir = path.join(os.tmpdir(), `openplc-lib-xml2st-${randomUUID()}`)
      try {
        await fs.mkdir(sessionDir, { recursive: true })
        const xmlPath = path.join(sessionDir, 'plc.xml')
        const programStPath = path.join(sessionDir, 'program.st')
        await fs.writeFile(xmlPath, xmlResult.data, 'utf-8')

        await deps.transpileXmlToSt(
          xmlPath,
          (chunk, level) => log(typeof chunk === 'string' ? chunk : chunk.toString(), level ?? 'info'),
          ['--keep-structs'],
        )

        const programSt = await fs.readFile(programStPath, 'utf-8')
        return { ok: true, programSt }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`xml2st failed: ${message}`, 'error')
        return { ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] }
      } finally {
        // Best-effort cleanup.  Leaks aren't fatal (os.tmpdir is
        // the OS's responsibility) but tidying after ourselves
        // keeps the dev disk clean.
        await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {
          /* swallow — the temp dir is the OS's to GC */
        })
      }
    },

    async readBuildFile(projectPath: string, relPath: string): Promise<string | null> {
      const fullPath = resolveProjectRelativePath(projectPath, relPath)
      try {
        return await fs.readFile(fullPath, { encoding: 'utf8' })
      } catch (error) {
        if (isFsNotFound(error)) return null
        throw error
      }
    },

    async writeBuildFile(projectPath: string, relPath: string, content: string): Promise<void> {
      const fullPath = resolveProjectRelativePath(projectPath, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
    },

    async deleteBuildSubtree(projectPath: string, relPath: string): Promise<void> {
      const fullPath = resolveProjectRelativePath(projectPath, relPath)
      // `force: true` makes the call a no-op when the subtree is
      // absent — matches the contract.  `recursive: true` wipes the
      // whole subtree, mirroring the pre-refactor `fs.rm` call site.
      await fs.rm(fullPath, { recursive: true, force: true })
    },

    loadLibraryArchives({ projectLibraryRefs }) {
      // Bridge resolves bundled (always-included) + user-installed
      // archives in one call; names that don't resolve come back
      // under `missing` for the orchestrator to fail the build on.
      return Promise.resolve(deps.loadEnabledArchives(projectLibraryRefs.map((r) => r.name)))
    },

    async verifyCompile({ projectPath, verifyProjectData, emit }) {
      return deps.runVerificationCompile({
        projectPath,
        verifyProjectData,
        // `runVerificationCompile` forwards every line off
        // `compileProgram`'s message port; pass them straight
        // through to the orchestrator's emit.
        emit: (message, level) => emit(message, level ?? 'info'),
      })
    },
  }
}

/**
 * Normalises a project-relative path to an absolute fs path while
 * preserving the path-containment guarantee the orchestrator relies
 * on (no `..`-escapes out of the project root).  The pre-refactor
 * code did the join manually; routing through `assertPathContained`
 * here makes the symmetric web port impl's S3-key sanitisation
 * easier to mirror.
 */
function resolveProjectRelativePath(projectPath: string, relPath: string): string {
  const normalizedProjectPath = projectPath.replace(/\/project\.json$/, '')
  const joined = path.join(normalizedProjectPath, relPath)
  assertPathContained(normalizedProjectPath, joined, 'relPath')
  return joined
}

function isFsNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT'
}
