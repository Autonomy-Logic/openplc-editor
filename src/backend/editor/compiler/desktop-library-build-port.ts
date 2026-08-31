// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Desktop implementation of {@link LibraryBuildPort}.
 *
 * Owns ONLY the platform-specific primitives the shared
 * `runLibraryBuildPipeline` cannot perform itself:
 *
 *   - MD5 hashing (Node `crypto`)
 *   - ST transpilation via the in-process JSON-fed transpiler
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

import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { assertPathContained } from '@root/backend/editor/utils/path-containment'
import {
  fromSchemaShape,
  type SchemaProjectData,
  transpileToSt as runJsonTranspiler,
} from '@root/backend/shared/transpilers/st-transpiler'
import type { TranspileToStArgs, TranspileToStResult } from '@root/middleware/shared/ports/compiler-platform-port'
import type { LibraryBuildPort, LibraryVerifyTarget } from '@root/middleware/shared/ports/library-build-port'

/**
 * Subset of the desktop CompilerModule that the port leans on.
 * Injected (not imported as a module reference) so this file's
 * surface stays narrow + unit-testable.
 */
export interface DesktopLibraryBuildPortDeps {
  /**
   * Resolve the names of project-enabled libraries to their parsed
   * `.stlib` archives.  Bundled IEC standard set is included
   * automatically.  Names that can't be resolved come back under
   * `missing` — orchestrator fails the build with a Library-Manager-
   * pointing message before any heavy step runs.
   */
  loadEnabledArchives(enabledNames: string[]): { archives: unknown[]; missing: string[] }

  /**
   * Run a verification compile against `target`.  Wraps
   * `CompilerModule.runVerificationCompile` so the port stays decoupled
   * from the compiler module's full surface.  Failures here are advisory —
   * caller surfaces them as warnings, never as a fatal build error.
   */
  runVerificationCompile(args: {
    projectPath: string
    verifyProjectData: unknown
    target: LibraryVerifyTarget
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

    transpileToSt(
      args: TranspileToStArgs,
      log: (message: string, level: 'info' | 'warning' | 'error') => void,
    ): Promise<TranspileToStResult> {
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
          return Promise.resolve({ ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] })
        }
        for (const warning of result.warnings) {
          log(warning, 'info')
        }
        return Promise.resolve({ ok: true, programSt: result.programSt })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`transpile-from-json failed: ${message}`, 'error')
        return Promise.resolve({ ok: false, errors: [{ message, line: 0, column: 0, severity: 'error' }] })
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

    async readBuildFileBase64(projectPath: string, relPath: string): Promise<string | null> {
      const fullPath = resolveProjectRelativePath(projectPath, relPath)
      try {
        return (await fs.readFile(fullPath)).toString('base64')
      } catch (error) {
        if (isFsNotFound(error)) return null
        throw error
      }
    },

    async listProjectDirs(projectPath: string, relPath: string): Promise<string[]> {
      const root = resolveProjectRelativePath(projectPath, relPath)
      let entries
      try {
        entries = await fs.readdir(root, { withFileTypes: true })
      } catch (error) {
        if (isFsNotFound(error)) return []
        throw error
      }
      // Symlinks are not followed here for the same reason they are not
      // followed when walking: a link out of the tree would put files the
      // author never chose into a published archive.
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    },

    async writeBuildFile(projectPath: string, relPath: string, content: string): Promise<void> {
      const fullPath = resolveProjectRelativePath(projectPath, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
    },

    async listProjectFiles(projectPath: string, relPath: string): Promise<string[]> {
      const root = resolveProjectRelativePath(projectPath, relPath)
      const walk = async (dir: string, prefix: string): Promise<string[]> => {
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch (error) {
          if (isFsNotFound(error)) return []
          throw error
        }
        const found: string[] = []
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          // Symlinks are not followed: a link out of the tree would put
          // arbitrary files into a published archive.
          if (entry.isDirectory()) {
            found.push(...(await walk(path.join(dir, entry.name), rel)))
          } else if (entry.isFile()) {
            found.push(rel)
          }
        }
        return found
      }
      return (await walk(root, '')).sort()
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

    async verifyCompile({ projectPath, verifyProjectData, target, emit }) {
      return deps.runVerificationCompile({
        projectPath,
        verifyProjectData,
        target,
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
