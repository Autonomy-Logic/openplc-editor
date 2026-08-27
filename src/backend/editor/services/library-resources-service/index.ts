// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * A library project's `resources/` directory, as the Build Settings dialog
 * manages it.
 *
 * `resources/` holds one folder per C/C++ library the project's blocks
 * compile against, each laid out the ordinary Arduino way
 * (`library.properties` beside `src/`).  The build packages every folder into
 * the `.stlib` verbatim and both consumers — arduino-cli and the runtime
 * Makefile — resolve each as a library.  See
 * `library-build-orchestrator.readResources` for the read side.
 *
 * The editor writes here so the author does not have to manage the directory
 * on disk.  Everything below takes an absolute project path the caller has
 * already checked against the open project.
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

import { isSafeRelativePath } from '@root/backend/shared/utils/path-safety'

import { assertPathContained } from '../../utils/path-containment'

/** Project-relative directory the folders live in. */
const RESOURCES_DIR = 'resources'

/**
 * Bounds on a folder being added.  A picker makes it one click to choose a
 * home directory by mistake, and the copy would otherwise run until the disk
 * filled.  Generous enough that no real library approaches them.
 */
const MAX_FILES = 2000
const MAX_BYTES = 20 * 1024 * 1024

/** Directories never carried into `resources/`: version-control and
 *  dependency trees belong to the source repository, not to the library. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

/** One library folder under `resources/`, with the files it ships. */
export interface LibraryResourceFolder {
  name: string
  /** Paths relative to the folder, `/`-separated and sorted. */
  files: string[]
}

export interface AddLibraryResourceResult {
  success: boolean
  folder?: LibraryResourceFolder
  error?: string
}

/**
 * Every library folder under the project's `resources/`, sorted by name.
 * Returns `[]` when the directory is absent — a library project created
 * before `resources/` was scaffolded is not an error.
 *
 * Loose files directly under `resources/` are not listed: they belong to no
 * library and the build skips them.  `README.md` is the one the editor itself
 * writes there.
 */
export async function listLibraryResources(projectPath: string): Promise<LibraryResourceFolder[]> {
  const root = join(projectPath, RESOURCES_DIR)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const folders: LibraryResourceFolder[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    folders.push({ name: entry.name, files: await walkFiles(join(root, entry.name)) })
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Copy `sourcePath` into the project's `resources/` under its own name.
 *
 * Refuses rather than merges when a folder of that name is already there:
 * copying over a library the author has edited in place would lose those
 * edits silently.  They remove it first.
 */
export async function addLibraryResource(projectPath: string, sourcePath: string): Promise<AddLibraryResourceResult> {
  // Arduino library names carry spaces ("Adafruit BusIO"), so the name is
  // only checked for what would make it unusable as a path component.
  const name = basename(sourcePath)
  if (!isSafeRelativePath(name) || name.includes('/') || name.includes('\\')) {
    return { success: false, error: `"${name}" is not a usable folder name.` }
  }

  const destination = join(projectPath, RESOURCES_DIR, name)

  try {
    await stat(destination)
    return { success: false, error: `"${name}" is already in resources. Remove it first to replace it.` }
  } catch {
    // Absent, which is what we want.
  }

  const measured = await measure(sourcePath)
  if ('error' in measured) return { success: false, error: measured.error }

  try {
    await mkdir(join(projectPath, RESOURCES_DIR), { recursive: true })
    await cp(sourcePath, destination, {
      recursive: true,
      // A link out of the tree would put files the author never chose into a
      // published archive.
      dereference: false,
      filter: (source) => !SKIPPED_DIRS.has(basename(source)),
    })
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }

  return { success: true, folder: { name, files: await walkFiles(destination) } }
}

/** Remove one library folder from `resources/`. */
export async function removeLibraryResource(
  projectPath: string,
  folderName: string,
): Promise<{ success: boolean; error?: string }> {
  const root = join(projectPath, RESOURCES_DIR)
  // The name reaches here from the renderer, so it is checked as a path
  // component before it is used as one.
  if (!isSafeRelativePath(folderName) || folderName.includes('/') || folderName.includes('\\')) {
    return { success: false, error: `"${folderName}" is not a folder in resources.` }
  }
  const target = join(root, folderName)
  try {
    assertPathContained(root, target, 'Folder name')
  } catch {
    return { success: false, error: `"${folderName}" is not a folder in resources.` }
  }

  try {
    await rm(target, { recursive: true, force: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * File count and total size of a candidate folder, or the reason it is too
 * big to carry.  Walked before the copy so an accidental pick fails fast
 * instead of half-copying.
 */
async function measure(root: string): Promise<{ files: number; bytes: number } | { error: string }> {
  let files = 0
  let bytes = 0
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      files += 1
      if (files > MAX_FILES) {
        return { error: `That folder holds more than ${MAX_FILES} files — it does not look like a library.` }
      }
      bytes += (await stat(full)).size
      if (bytes > MAX_BYTES) {
        return {
          error: `That folder is larger than ${MAX_BYTES / (1024 * 1024)} MB — it does not look like a library.`,
        }
      }
    }
  }
  return { files, bytes }
}

/** Every file under `root`, relative and `/`-separated, sorted. Symlinks are
 *  not followed, matching what the build packages. */
async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        found.push(relative(root, full).split(sep).join('/'))
      }
    }
  }
  return found.sort()
}
