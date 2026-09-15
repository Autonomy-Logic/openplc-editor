/**
 * `openplc-cli library pin` / `unpin` — choose which installed version of a
 * library a project compiles against.
 *
 * The pin lives in `project.json` as `data.libraries[]`, and the compiler
 * resolves it through `loadEnabledArchives` → `resolveVersion`, so changing it
 * changes the generated code. The GUI drives this from the Library Manager's
 * Project Libraries tab; without these commands the version model cannot be
 * exercised from a script at all.
 *
 * The write is surgical — `withProjectLibraries` replaces one field and leaves
 * the rest of the document alone, the same helper the GUI's save path uses.
 *
 * Placed blocks are REPORTED, not rewritten. Applying a library-added pin needs
 * the language's own `getBlockSize`, which lives in the components layer the CLI
 * may not import; the GUI reconciles on the next project open.
 */

import { openPLCStoreBase } from '@root/frontend/store'
import type { FBDFlowType, LadderFlowType } from '@root/frontend/store/slices'
import type { SystemLibrary } from '@root/frontend/store/slices/library/types'
import { type ProjectLibraryRef, withProjectLibraries } from '@root/frontend/utils/PLC/project-libraries-json'
import {
  type RestampChange,
  restampFlowLibraryVariants,
  summariseRestampChanges,
} from '@root/frontend/utils/PLC/restamp-library-variants'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { loadProject } from '../project/load'

interface PinnedProject {
  projectPath: string
  refs: ProjectLibraryRef[]
  warnings: string[]
}

/**
 * Load the project and hand back its current refs. `loadProject` hydrates the
 * library pool first, which is what makes the restamp below meaningful.
 */
async function openForPinning(
  reporter: Reporter,
  projectPath: string,
): Promise<{ ok: true; project: PinnedProject } | { ok: false; result: CliResult }> {
  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return {
      ok: false,
      result: reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound),
    }
  }
  for (const warning of loaded.project.warnings) reporter.progress(warning)

  return {
    ok: true,
    project: {
      projectPath: loaded.project.projectPath,
      refs: (loaded.project.data.libraries ?? []).map((ref) => ({ name: ref.name, version: ref.version })),
      warnings: loaded.project.warnings,
    },
  }
}

/** Rewrite `data.libraries` in place, touching nothing else in the document. */
async function writeRefs(
  projectPath: string,
  refs: ProjectLibraryRef[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fullPath = join(projectPath, 'project.json')
  let onDisk: string
  try {
    onDisk = await readFile(fullPath, 'utf-8')
  } catch {
    return { ok: false, error: `Could not read ${fullPath}` }
  }

  const rewritten = withProjectLibraries(onDisk, refs)
  if (!rewritten.ok) return { ok: false, error: rewritten.error }

  try {
    await writeFile(fullPath, rewritten.json, 'utf-8')
  } catch (err) {
    return { ok: false, error: `Could not write ${fullPath}: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true }
}

/**
 * Re-point the store at the new refs and report what the placed blocks would
 * become. Flows are cloned because the restamp mutates in place and the store
 * freezes its state.
 */
function describePlacedBlockDrift(refs: ProjectLibraryRef[]): { changes: RestampChange[]; poolEmpty: boolean } {
  openPLCStoreBase.getState().libraryActions.setProjectLibraries(refs)
  const state = openPLCStoreBase.getState()
  const systemLibraries: SystemLibrary[] = state.libraries.system
  const userPouNames = state.project.data.pous.map((pou) => pou.name)

  const changes: RestampChange[] = []
  let poolEmpty = false

  for (const pou of state.project.data.pous) {
    if (pou.body.language !== 'ld' && pou.body.language !== 'fbd') continue
    const flow = structuredClone(pou.body.value) as LadderFlowType | FBDFlowType
    const report = restampFlowLibraryVariants([flow], systemLibraries, userPouNames, { pou: pou.name })
    changes.push(...report.changes)
    poolEmpty = poolEmpty || report.poolEmpty
  }

  return { changes, poolEmpty }
}

function reportDrift(reporter: Reporter, drift: { changes: RestampChange[]; poolEmpty: boolean }): void {
  if (drift.poolEmpty) {
    reporter.progress('  warning: no libraries are installed, so placed blocks were not checked.')
    return
  }
  for (const line of summariseRestampChanges(drift.changes)) {
    reporter.progress(`  ${line.severity === 'info' ? '' : `${line.severity}: `}${line.message}`)
  }
}

export async function runLibraryPin(
  reporter: Reporter,
  projectPath: string | undefined,
  ref: string | undefined,
): Promise<CliResult> {
  if (!projectPath || !ref) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library pin needs a project path and name@version.' },
      ExitCode.Usage,
    )
  }

  const at = ref.lastIndexOf('@')
  if (at <= 0) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: `library pin needs a version: ${ref}@<version>.` },
      ExitCode.Usage,
    )
  }
  const name = ref.slice(0, at)
  const version = ref.slice(at + 1)

  const opened = await openForPinning(reporter, projectPath)
  if (!opened.ok) return opened.result

  // Refuse a pin the compiler would only silently substitute later.
  const installed = openPLCStoreBase
    .getState()
    .installedLibraries.filter((library: SystemLibrary) => library.name === name)
    .map((library: SystemLibrary) => library.version)
  if (installed.length === 0) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `Library '${name}' is not installed.` },
      ExitCode.NotFound,
    )
  }
  if (!installed.includes(version)) {
    return reporter.failure(
      {
        code: ErrorCode.TargetError,
        message: `Library '${name}' version ${version} is not installed. Installed: ${installed.join(', ')}.`,
      },
      ExitCode.NotFound,
    )
  }

  const previous = opened.project.refs.find((entry) => entry.name === name)?.version ?? null
  const nextRefs = opened.project.refs.some((entry) => entry.name === name)
    ? opened.project.refs.map((entry) => (entry.name === name ? { name, version } : entry))
    : [...opened.project.refs, { name, version }]

  const written = await writeRefs(opened.project.projectPath, nextRefs)
  if (!written.ok) {
    return reporter.failure({ code: ErrorCode.Internal, message: written.error }, ExitCode.Internal)
  }

  reporter.progress(previous === null ? `Added ${name} ${version}.` : `Repinned ${name} ${previous} → ${version}.`)
  const drift = describePlacedBlockDrift(nextRefs)
  reportDrift(reporter, drift)

  return reporter.success(
    {
      ok: true,
      library: name,
      previous,
      version,
      placedBlockChanges: drift.changes.length,
    },
    () =>
      [
        previous === null ? `Pinned ${name} ${version}` : `Pinned ${name} ${version} (was ${previous})`,
        drift.changes.length > 0
          ? `  ${drift.changes.length} placed-block change(s) reported — open the project to apply them`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
  )
}

export async function runLibraryUnpin(
  reporter: Reporter,
  projectPath: string | undefined,
  name: string | undefined,
): Promise<CliResult> {
  if (!projectPath || !name) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'library unpin needs a project path and a library name.' },
      ExitCode.Usage,
    )
  }

  const opened = await openForPinning(reporter, projectPath)
  if (!opened.ok) return opened.result

  const current = opened.project.refs.find((entry) => entry.name === name)
  if (!current) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `The project does not reference '${name}'.` },
      ExitCode.NotFound,
    )
  }

  const nextRefs = opened.project.refs.filter((entry) => entry.name !== name)
  const written = await writeRefs(opened.project.projectPath, nextRefs)
  if (!written.ok) {
    return reporter.failure({ code: ErrorCode.Internal, message: written.error }, ExitCode.Internal)
  }

  return reporter.success(
    { ok: true, library: name, removed: current.version, libraries: nextRefs },
    () => `Removed ${name} ${current.version} from the project`,
  )
}
