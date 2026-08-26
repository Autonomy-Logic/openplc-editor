// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The library build's inventory of native (C/C++, Python) POUs.
 *
 * Must be taken from the project data BEFORE `preprocessPous` runs. That step
 * lowers every native body to its bridge ST and rewrites the language tag with
 * it — `body: { language: 'st', value: <bridge ST> }` — so afterwards there is
 * nothing left to identify a native POU by. A build that inferred the list
 * post-lowering found none, shipped the generated bridge in the archive instead
 * of the authored source, and produced exactly the frozen-ABI artifact the
 * design exists to avoid.
 *
 * Both platforms compute this at their own adapter boundary, where the raw
 * project data still exists, and pass it into `runLibraryBuildPipeline`.
 */

import type { PLCProjectData } from '../../../middleware/shared/ports/types'

/** Directory the editor persists each POU kind under. */
const POU_REL_DIR: Record<string, string> = {
  program: 'pous/programs',
  function: 'pous/functions',
  'function-block': 'pous/function-blocks',
}

/** One native POU, enough to find its authored file and label its language. */
export interface NativePouRef {
  name: string
  language: 'cpp' | 'python'
  /** Project-relative path of the authored file, e.g.
   *  `pous/function-blocks/TCP_CLIENT.cpp`. Derived from the POU type, because
   *  a hand-authored project may declare a native POU as a FUNCTION — strucpp
   *  rejects that with a message explaining why, and it can only do so if the
   *  build hands it the file instead of failing on a path guessed wrong. */
  relPath: string
}

/** File extension the editor writes a native POU of this language under. */
function extensionFor(language: 'cpp' | 'python'): string {
  return language === 'cpp' ? 'cpp' : 'py'
}

/**
 * Native POUs in `projectData`, in declaration order.
 *
 * Call this on RAW project data — before `preprocessPous`. Returns an empty
 * array for a project with no native POUs, which is the common case.
 */
export function collectNativePous(projectData: PLCProjectData): NativePouRef[] {
  const refs: NativePouRef[] = []
  for (const pou of projectData.pous) {
    const language = pou.body?.language
    if (language !== 'cpp' && language !== 'python') continue
    const fileName = `${pou.name}.${extensionFor(language)}`
    const dir = POU_REL_DIR[pou.pouType] ?? POU_REL_DIR['function-block']
    refs.push({ name: pou.name, language, relPath: `${dir}/${fileName}` })
  }
  return refs
}
