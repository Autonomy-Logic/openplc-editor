// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The one place a candidate element name is checked against everything
 * that already owns it.
 *
 * Two namespaces overlap. IEC puts POUs, derived types, global variables
 * and library symbols in one identifier namespace, so a collision across
 * those kinds is a duplicate symbol. The workspace keys `files[name]`,
 * tabs, editor models and `undoRedo[name]` by element name for POUs, data
 * types, global variable lists, servers, remote devices and EtherCAT slaves,
 * so one entry would serve two elements. A kind is checked against every other kind it
 * shares a namespace with, and against nothing else.
 */

import type { LibraryPouType } from '../../../../middleware/shared/ports/library-types'
import { globalVariableListTypeName } from '../../../utils/PLC/global-variable-list-serializer'
import type { LibrarySlice } from '../library'
import type { ProjectSlice } from '../project'

export type NameCollisionState = Pick<ProjectSlice, 'project' | 'unparsedDataTypeFiles'> &
  Pick<LibrarySlice, 'libraries'>

/**
 * Element names are compared case-insensitively: IEC identifiers are, and a
 * data type becomes a `datatypes/<Name>.dt` path, a POU a
 * `pous/<folder>/<Name><ext>` one, and macOS/Windows fold filename case.
 */
export const nameMatches = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export type NamedElementKind =
  | 'pou'
  | 'data-type'
  | 'global-variable-list'
  | 'server'
  | 'remote-device'
  | 'ethercat-slave'
  | 'resource-global'

/** Kinds the compiler sees as top-level identifiers. */
const COMPILER_SYMBOL: Record<NamedElementKind, boolean> = {
  pou: true,
  'data-type': true,
  'global-variable-list': true,
  'resource-global': true,
  server: false,
  'remote-device': false,
  'ethercat-slave': false,
}

/** Kinds with a tab, and so an entry in the name-keyed workspace registries. */
const WORKSPACE_ELEMENT: Record<NamedElementKind, boolean> = {
  pou: true,
  'data-type': true,
  'global-variable-list': true,
  server: true,
  'remote-device': true,
  'ethercat-slave': true,
  'resource-global': false,
}

/**
 * Kinds that own a file path named after them. A case-only rename would write
 * the new file over the old one on a case-folding filesystem, so the element's
 * own entry stays eligible to collide with the new spelling.
 */
const OWNS_FILE: Record<NamedElementKind, boolean> = {
  pou: true,
  'data-type': true,
  server: true,
  'remote-device': true,
  'global-variable-list': false,
  'ethercat-slave': false,
  'resource-global': false,
}

const SAME_KIND_TAKEN: Record<Exclude<NamedElementKind, 'resource-global' | 'ethercat-slave'>, string> = {
  pou: 'POU name already exists',
  'data-type': 'Data type name already exists',
  'global-variable-list': 'Global variable list name already exists',
  server: 'Server already exists',
  'remote-device': 'Remote device already exists',
}

const sameKindTaken = (kind: Exclude<NamedElementKind, 'resource-global'>, name: string): string =>
  kind === 'ethercat-slave' ? `An EtherCAT slave named "${name}" already exists in this project` : SAME_KIND_TAKEN[kind]

const KIND_LABEL: Record<NamedElementKind, string> = {
  pou: 'a POU',
  'data-type': 'a data type',
  'global-variable-list': 'a global variable list',
  server: 'a server',
  'remote-device': 'a remote device',
  'ethercat-slave': 'an EtherCAT slave',
  'resource-global': 'a global variable',
}

const LIBRARY_SYMBOL_KIND: Record<LibraryPouType, string> = {
  function: 'function',
  'function-block': 'function block',
}

interface NamedElement {
  kind: NamedElementKind
  name: string
}

function namedElements(state: NameCollisionState): NamedElement[] {
  const { pous, dataTypes, globalVariableLists, servers, remoteDevices, configurations } = state.project.data
  return [
    ...pous.map((pou): NamedElement => ({ kind: 'pou', name: pou.name })),
    ...dataTypes.map((dataType): NamedElement => ({ kind: 'data-type', name: dataType.name })),
    ...(globalVariableLists ?? []).map((list): NamedElement => ({ kind: 'global-variable-list', name: list.name })),
    ...(servers ?? []).map((server): NamedElement => ({ kind: 'server', name: server.name })),
    ...(remoteDevices ?? []).map((device): NamedElement => ({ kind: 'remote-device', name: device.name })),
    ...(remoteDevices ?? []).flatMap((device) =>
      (device.ethercatConfig?.devices ?? []).map(
        (slave): NamedElement => ({ kind: 'ethercat-slave', name: slave.name }),
      ),
    ),
    ...(configurations.resource.globalVariables ?? []).map(
      (variable): NamedElement => ({ kind: 'resource-global', name: variable.name }),
    ),
  ]
}

const sharesNamespace = (a: NamedElementKind, b: NamedElementKind): boolean =>
  (COMPILER_SYMBOL[a] && COMPILER_SYMBOL[b]) || (WORKSPACE_ELEMENT[a] && WORKSPACE_ELEMENT[b])

/**
 * The library symbol, if any, that already owns `name`.
 *
 * Library functions and function blocks are declared in the same generated
 * namespace as the project's own elements, and the bundled archives are in
 * every build regardless of the project's `libraries` list — so no setting
 * makes such a name safe. The whole installed pool counts, not just the
 * bundled set: enabling a library later must not turn a project that
 * compiles into one that does not.
 */
function librarySymbolOwning(state: NameCollisionState, name: string): { library: string; kind: string } | null {
  for (const library of state.libraries.system) {
    const symbol = library.pous.find((pou) => nameMatches(pou.name, name))
    if (symbol) return { library: library.name, kind: LIBRARY_SYMBOL_KIND[symbol.type] }
  }
  return null
}

/** An unreadable `datatypes/<Name>.dt` keeps its `files[name]` entry, so its name stays taken in the workspace. */
function unparsedDataTypeFileOwning(state: NameCollisionState, name: string): string | null {
  const collides = state.unparsedDataTypeFiles.some(
    (f) => f.relativePath.split('/').pop()?.replace(/\.dt$/i, '').toLowerCase() === name.toLowerCase(),
  )
  return collides
    ? `A data type file named "${name}.dt" exists on disk but could not be read — fix or remove it first`
    : null
}

/**
 * Why an element of `kind` may not be called `name`, or `null` when it may.
 *
 * `ignoring` is the element being renamed, so it does not collide with
 * itself. Same-kind duplicates of resource globals are not this gate's
 * business: the variables table owns them, and the "+" button relies on
 * cloning a row and auto-incrementing the clash away.
 */
export function elementNameCollision(
  state: NameCollisionState,
  name: string,
  kind: NamedElementKind,
  ignoring?: string,
): string | null {
  const isSelf = (candidate: string): boolean =>
    ignoring !== undefined && (OWNS_FILE[kind] ? candidate === ignoring : nameMatches(candidate, ignoring))
  if (isSelf(name)) return null

  // A file-owning element stays in the pool: its own entry is what a case-only
  // rename has to collide with.
  const others = OWNS_FILE[kind]
    ? namedElements(state)
    : namedElements(state).filter((element) => !(element.kind === kind && isSelf(element.name)))

  if (kind !== 'resource-global' && others.some((o) => o.kind === kind && nameMatches(o.name, name))) {
    return sameKindTaken(kind, name)
  }
  const taken = others.find((o) => o.kind !== kind && sharesNamespace(kind, o.kind) && nameMatches(o.name, name))
  if (taken) return `"${name}" is already the name of ${KIND_LABEL[taken.kind]}`

  if (WORKSPACE_ELEMENT[kind]) {
    const unparsed = unparsedDataTypeFileOwning(state, name)
    if (unparsed) return unparsed
  }
  if (!COMPILER_SYMBOL[kind]) return null

  // A list occupies TWO symbols: the instance keeps the user's name, the struct
  // backing it takes `<name>_TYPE`.
  const lists = others.filter((o) => o.kind === 'global-variable-list')
  const listOwningTheName = lists.find((list) => nameMatches(globalVariableListTypeName(list.name), name))
  if (listOwningTheName) {
    return `"${name}" is the type name of global variable list "${listOwningTheName.name}"`
  }

  const librarySymbol = librarySymbolOwning(state, name)
  if (librarySymbol) {
    return `"${name}" is a ${librarySymbol.kind} in the ${librarySymbol.library} library`
  }

  if (kind !== 'global-variable-list') return null

  const derived = globalVariableListTypeName(name)
  if (others.some((o) => o.kind === 'data-type' && nameMatches(o.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a data type already uses`
  }
  if (others.some((o) => o.kind === 'pou' && nameMatches(o.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a POU already uses`
  }
  if (others.some((o) => o.kind === 'resource-global' && nameMatches(o.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a global variable already uses`
  }
  // Against the other lists' own names as well as their derived ones: the pair
  // `GVL` / `GVL_TYPE` collides whichever of the two is created first.
  if (lists.some((list) => nameMatches(list.name, derived))) {
    return `"${name}" needs the type name "${derived}", which a global variable list already uses`
  }
  if (lists.some((list) => nameMatches(globalVariableListTypeName(list.name), derived))) {
    return `"${name}" needs the type name "${derived}", which another global variable list already uses`
  }
  if (unparsedDataTypeFileOwning(state, derived)) {
    return `"${name}" needs the type name "${derived}", which a data type file already uses`
  }
  const derivedLibrarySymbol = librarySymbolOwning(state, derived)
  if (derivedLibrarySymbol) {
    return `"${name}" needs the type name "${derived}", which is a ${derivedLibrarySymbol.kind} in the ${derivedLibrarySymbol.library} library`
  }
  return null
}

/**
 * The first collision among `names` that the globals table does not already
 * hold. Names already in the table were accepted when written; only what a
 * commit introduces is gated.
 */
export function newGlobalNameCollision(state: NameCollisionState, names: string[]): string | null {
  const held = new Set(
    (state.project.data.configurations.resource.globalVariables ?? []).map((variable) => variable.name.toLowerCase()),
  )
  for (const name of names) {
    if (held.has(name.toLowerCase())) continue
    const collision = elementNameCollision(state, name, 'resource-global')
    if (collision) return collision
  }
  return null
}
