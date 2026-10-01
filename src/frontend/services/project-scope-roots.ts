// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Symbol roots the project declares. strucpp puts library globals in the same
 * scope as the project's own with nothing to tell them apart, so graphical
 * completions filter by declaration instead.
 */

import type { PLCProjectData } from '../../middleware/shared/ports/types'
import { softMotionAxisNames } from '../../middleware/shared/utils/ethercat'

/** Leading identifier of an expression: `arr[3].x` gives `ARR`. */
export function rootIdentifierOf(expression: string): string {
  const trimmed = expression.trim()
  const end = trimmed.search(/[.[]/)
  return (end === -1 ? trimmed : trimmed.slice(0, end)).toUpperCase()
}

/** Uppercased roots declared in `pouName`'s scope. Mirrors the documents `st-lsp/project-sync.ts` feeds the worker. */
export function collectDeclaredRoots(project: PLCProjectData, pouName: string): Set<string> {
  const pou = project.pous.find((p) => p.name === pouName)
  const names = [
    ...(pou?.interface?.variables ?? []).map((variable) => variable.name),
    ...project.configurations.resource.globalVariables.map((variable) => variable.name),
    ...(project.globalVariableLists ?? []).map((list) => list.name),
    // Axes are ambient: declared nowhere in the project's variables.
    ...softMotionAxisNames(project),
  ]
  return new Set(names.map((name) => name.toUpperCase()))
}
