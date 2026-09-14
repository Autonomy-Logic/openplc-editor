/**
 * Turn an `apply` spec into store actions, in an order that works.
 *
 * The ordering is not cosmetic. Several store actions refuse or silently no-op
 * when what they reference does not exist yet:
 *
 *   - a variable with `scope: 'local'` fails with "POU not found" unless its
 *     POU is already created;
 *   - a variable whose type is a user data type needs that type registered, or
 *     the editor classifies it as unknown;
 *   - an instance names a task and a program by string and validates neither,
 *     so a wrong order produces a project that only fails much later, in the
 *     IEC compiler, with "program not found".
 *
 * So: data types, then POUs, then bodies, then variables, then tasks, then
 * instances. An agent cannot see any of this, which is the whole reason `apply`
 * takes a declarative document rather than a sequence of commands.
 */

import { openPLCStoreBase } from '@root/frontend/store'
import { elementNameCollision } from '@root/frontend/store/slices/shared/name-collision'
import { isLegalIdentifier } from '@root/frontend/utils/keywords'
import { baseTypeEnum } from '@root/middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCVariable } from '@root/middleware/shared/ports/types'

import { applyFbdBody } from './fbd'
import { applyLadderBody } from './ladder'
import { applyRemoteDevices, applyServers, pruneProtocols } from './protocol'
import type { ApplySpec, SpecDataType, SpecPou, SpecVariable } from './schema'

export interface PlannedChange {
  kind:
    | 'data-type'
    | 'pou'
    | 'body'
    | 'variable'
    | 'task'
    | 'instance'
    | 'device'
    | 'library'
    | 'gvl'
    | 'server'
    | 'remote-device'
    | 'io-group'
    | 'ethercat-slave'
  action: 'create' | 'update' | 'delete'
  name: string
}

export interface ApplyOutcome {
  changes: PlannedChange[]
  errors: string[]
}

type Store = ReturnType<typeof openPLCStoreBase.getState>

/** Languages whose body is a plain string. */
const TEXTUAL = new Set(['st', 'il', 'python', 'cpp'])

/**
 * `projectPath` is needed only by the EtherCAT section, which reads the
 * project's own ESI repository off disk — which is also why this is async.
 */
export async function applySpec(
  spec: ApplySpec,
  options: { prune: boolean; projectPath: string },
): Promise<ApplyOutcome> {
  const changes: PlannedChange[] = []
  const errors: string[] = []

  applyDevice(spec, changes)
  applyLibraries(spec, changes, errors)
  applyDataTypes(spec, changes, errors)
  applyGlobalVariableLists(spec, changes, errors)
  applyPous(spec, changes, errors)
  applyVariables(spec, changes, errors)
  // Bodies LAST, after every POU has its variables. A graphical body placing a
  // `user/<pou>` block resolves that block's pins from the POU's own variable
  // list, so a body applied in the same pass that created the POU sees an
  // interface with no pins at all.
  applyBodies(spec, changes, errors)
  applyGlobalVariables(spec, changes, errors)
  applyTasks(spec, changes, errors)
  applyInstances(spec, changes, errors)
  applyServers(spec, changes, errors)
  await applyRemoteDevices(spec, options.projectPath, changes, errors)
  if (options.prune) {
    prune(spec, changes, errors)
    pruneProtocols(spec, changes)
  }

  // Any `location` that was bound changes the IEC address map, and nothing
  // recomputes it on the way out of these actions.
  if ((spec.globalVariables ?? []).some((variable) => variable.location) || specBindsLocation(spec)) {
    openPLCStoreBase.getState().projectActions.recalculateIecAddresses()
  }

  return { changes, errors }
}

function specBindsLocation(spec: ApplySpec): boolean {
  return (spec.pous ?? []).some((pou) => (pou.variables ?? []).some((variable) => variable.location))
}

// ---------------------------------------------------------------------------
// Device and project settings
// ---------------------------------------------------------------------------

/**
 * The build target.
 *
 * Written through `setDeviceDefinitions` rather than passed along the side,
 * because the debug-spec resolver reads `communicationPort` and
 * `runtimeIpAddress` off the store — the same reason `applyConnectionOverrides`
 * exists. A project whose board is never set compiles for whatever the scaffold
 * chose, which is rarely what was asked for.
 */
function applyDevice(spec: ApplySpec, changes: PlannedChange[]): void {
  if (!spec.device) return
  const configuration: Record<string, string> = {}
  if (spec.device.board) configuration.deviceBoard = spec.device.board
  if (spec.device.communicationPort !== undefined) configuration.communicationPort = spec.device.communicationPort
  if (spec.device.runtimeIpAddress !== undefined) configuration.runtimeIpAddress = spec.device.runtimeIpAddress

  // `setDeviceBoard` first, for the side effects a bulk write does not do: it
  // swaps the per-board vendor and persistent-storage buckets, clears the
  // platform options, and recomputes the IEC addresses.
  if (spec.device.board) {
    openPLCStoreBase.getState().deviceActions.setDeviceBoard(spec.device.board)
    changes.push({ kind: 'device', action: 'update', name: `board = ${spec.device.board}` })
  }

  // Before the bail-out below: a `device` section carrying nothing but
  // `persistentStorage` still has work to do.
  applyPersistentStorage(spec, changes)

  const rest = { ...configuration }
  delete rest.deviceBoard
  if (Object.keys(rest).length === 0) return

  // Merged onto the CURRENT configuration, not passed as a fragment.
  // `setDeviceDefinitions` REPLACES the object, filling the rest from defaults —
  // so a partial `{ runtimeIpAddress }` silently resets the board to the default
  // and the project saves for the wrong target.
  const current = openPLCStoreBase.getState().deviceDefinitions.configuration
  openPLCStoreBase.getState().deviceActions.setDeviceDefinitions({ configuration: { ...current, ...rest } as never })
  for (const [key, value] of Object.entries(rest)) {
    changes.push({ kind: 'device', action: 'update', name: `${key} = ${value || '(cleared)'}` })
  }
}

/** Libraries the project compiles against. Replaces the list wholesale. */
/**
 * The libraries a project enables.
 *
 * This list is for libraries INSTALLED through the Library Manager, which the
 * build resolves to an archive on disk. A library bundled with the editor has no
 * archive, so naming one here does not "declare a dependency" — it makes the
 * build stop with "enables libraries that are not installed", pointing at a
 * Library Manager that has nothing to install. Its blocks are usable either way.
 *
 * So a bundled name is refused here, where the message can say that, rather than
 * saved into a project that only fails at compile time.
 */
function applyLibraries(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  if (!spec.libraries) return

  const state = openPLCStoreBase.getState()
  const bundled = new Set(state.bundledLibraryNames)
  const known = new Set(state.libraries.system.map((library) => library.name))

  for (const ref of spec.libraries) {
    if (bundled.has(ref.name)) {
      errors.push(
        `library "${ref.name}" is bundled with the editor and must not be listed in "libraries": ` +
          'its blocks are available without it, and listing it stops the build with "not installed".',
      )
      continue
    }
    if (!known.has(ref.name)) {
      errors.push(`library "${ref.name}" is not installed, so a project enabling it cannot be built.`)
    }
  }
  if (errors.length > 0) return

  state.libraryActions.setProjectLibraries(spec.libraries)
  for (const ref of spec.libraries) {
    changes.push({ kind: 'library', action: 'update', name: `${ref.name}@${ref.version}` })
  }
}

function applyGlobalVariableLists(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.globalVariableLists ?? []) {
    const state: Store = openPLCStoreBase.getState()
    const existing = (state.project.data.globalVariableLists ?? []).some((list) => list.name === wanted.name)

    if (!existing) {
      const response = state.projectActions.createGlobalVariableList(wanted.name)
      if (!response.ok) {
        errors.push(`global variable list "${wanted.name}": ${response.message ?? 'could not be created'}`)
        continue
      }
      changes.push({ kind: 'gvl', action: 'create', name: wanted.name })
    }

    openPLCStoreBase.getState().projectActions.updateGlobalVariableList(
      wanted.name,
      wanted.variables.map((variable) => toVariable(variable, 'global')),
    )
    if (wanted.qualifier !== undefined) {
      openPLCStoreBase.getState().projectActions.updateGlobalVariableListQualifier(wanted.name, wanted.qualifier)
    }
    if (existing) changes.push({ kind: 'gvl', action: 'update', name: wanted.name })
  }
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

function toDataType(spec: SpecDataType): PLCDataType {
  if (spec.derivation === 'enumerated') {
    return {
      name: spec.name,
      derivation: 'enumerated',
      initialValue: spec.initialValue ?? '',
      values: spec.values.map((description) => ({ description })),
    } as PLCDataType
  }
  if (spec.derivation === 'structure') {
    return {
      name: spec.name,
      derivation: 'structure',
      variable: spec.variables.map((member) => ({
        name: member.name,
        // Through the same conversion as a variable: a member declared as an
        // array carried the spec's `dimensions` into the store, which keeps its
        // bounds in `data`, so the member silently degraded to a scalar of the
        // element type — `Trend : INT` where `ARRAY [0..2] OF INT` was asked
        // for.
        type: toVariableType(member.type),
        ...(member.initialValue ? { initialValue: { simpleValue: { value: member.initialValue } } } : {}),
        documentation: member.documentation ?? '',
      })),
    } as unknown as PLCDataType
  }
  return {
    name: spec.name,
    derivation: 'array',
    baseType: spec.baseType,
    initialValue: spec.initialValue ?? '',
    dimensions: spec.dimensions.map((dimension) => ({ dimension })),
  } as unknown as PLCDataType
}

/**
 * Check every identifier a data type introduces.
 *
 * `createDatatype` does not: a structure field named `Label` was accepted, and
 * the `.dt` written for it then failed to parse on the next load — the editor
 * preserves the file and warns, but the type is absent from the project and
 * every reference to it fails to compile as an undefined type. Refusing here
 * turns that into an error against the document that caused it.
 */
function checkDataTypeNames(wanted: SpecDataType): string[] {
  const problems: string[] = []
  const check = (name: string, what: string) => {
    const [legal, reason] = isLegalIdentifier(name)
    if (!legal) problems.push(`data type "${wanted.name}": ${what} "${name}" ${reason}.`)
  }

  check(wanted.name, 'the name')
  if (wanted.derivation === 'structure') for (const member of wanted.variables) check(member.name, 'field')
  if (wanted.derivation === 'enumerated') for (const value of wanted.values) check(value, 'value')
  return problems
}

function applyDataTypes(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.dataTypes ?? []) {
    const problems = checkDataTypeNames(wanted)
    if (problems.length > 0) {
      errors.push(...problems)
      continue
    }

    const state: Store = openPLCStoreBase.getState()
    const existing = state.project.data.dataTypes.find((type) => type.name === wanted.name)
    const data = toDataType(wanted)

    if (existing) {
      state.projectActions.updateDatatype(wanted.name, data)
      changes.push({ kind: 'data-type', action: 'update', name: wanted.name })
      continue
    }

    const response = state.projectActions.createDatatype({ data })
    if (!response.ok) {
      errors.push(`data type "${wanted.name}": ${response.message ?? 'could not be created'}`)
      continue
    }
    changes.push({ kind: 'data-type', action: 'create', name: wanted.name })
  }
}

// ---------------------------------------------------------------------------
// POUs and bodies
// ---------------------------------------------------------------------------

function applyPous(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.pous ?? []) {
    if (wanted.language === 'sfc') {
      errors.push(`POU "${wanted.name}": SFC bodies cannot be authored — the transpiler does not support them yet.`)
      continue
    }

    const state: Store = openPLCStoreBase.getState()
    const existing = state.project.data.pous.find((pou) => pou.name === wanted.name)

    if (!existing) {
      // `pouActions.create`, not `projectActions.createPou`: only the shared
      // action checks the name against every other element and seeds the
      // ladder/FBD flow. Without that seeding the graphical editor opens empty
      // and the next save writes that emptiness over the body.
      const response = state.pouActions.create({
        type: wanted.kind,
        name: wanted.name,
        language: wanted.language,
      })
      if (!response.ok) {
        errors.push(`POU "${wanted.name}": ${response.message ?? 'could not be created'}`)
        continue
      }
      changes.push({ kind: 'pou', action: 'create', name: wanted.name })
    }

    // A POU's language is fixed once it exists. The upsert path only ever set
    // it on create, so a spec asking for a different one was ignored in
    // silence — and worse than ignored: the body is written to a file named
    // for the NEW language while the old file stays, and the loader reads the
    // old one. The project then compiles a body the spec no longer describes.
    if (existing && existing.body.language !== wanted.language) {
      errors.push(
        `POU "${wanted.name}" is ${existing.body.language} and the spec asks for ${wanted.language}. ` +
          "A POU's language cannot be changed in place — its body is stored in a file named for the " +
          'language. Rename or remove the POU and declare a new one.',
      )
      continue
    }

    if (wanted.kind === 'function' && wanted.returnType) {
      openPLCStoreBase.getState().projectActions.updatePouReturnType(wanted.name, wanted.returnType)
    }
    if (wanted.documentation !== undefined) {
      openPLCStoreBase.getState().projectActions.updatePouDocumentation(wanted.name, wanted.documentation)
    }
  }
}

/** Second pass: every POU exists and has its variables, so a block resolves. */
function applyBodies(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.pous ?? []) {
    if (wanted.language === 'sfc') continue
    if (!openPLCStoreBase.getState().project.data.pous.some((pou) => pou.name === wanted.name)) continue
    applyBody(wanted, changes, errors)
  }
}

function applyBody(wanted: SpecPou, changes: PlannedChange[], errors: string[]): void {
  if (!wanted.body) return

  if (TEXTUAL.has(wanted.language)) {
    if (!('text' in wanted.body)) {
      errors.push(`POU "${wanted.name}": a ${wanted.language} body needs { "text": "..." }.`)
      return
    }

    const structural = checkNativeStructure(wanted.language, wanted.body.text)
    if (structural) {
      errors.push(`POU "${wanted.name}": ${structural}`)
      return
    }
    openPLCStoreBase.getState().projectActions.updatePou({
      name: wanted.name,
      content: { language: wanted.language, value: wanted.body.text } as never,
    })
    changes.push({ kind: 'body', action: 'update', name: wanted.name })
    return
  }

  if (wanted.language === 'ld') {
    if (!('rungs' in wanted.body)) {
      errors.push(`POU "${wanted.name}": a ladder body needs { "rungs": [...] }.`)
      return
    }
    const failures = applyLadderBody(wanted.name, wanted.body)
    if (failures.length > 0) {
      errors.push(...failures)
      return
    }
    changes.push({ kind: 'body', action: 'update', name: wanted.name })
    return
  }

  if (wanted.language === 'fbd') {
    if (!('nodes' in wanted.body)) {
      errors.push(`POU "${wanted.name}": an FBD body needs { "nodes": [...], "connections": [...] }.`)
      return
    }
    const failures = applyFbdBody(wanted.name, wanted.body)
    if (failures.length > 0) {
      errors.push(...failures)
      return
    }
    changes.push({ kind: 'body', action: 'update', name: wanted.name })
    return
  }

  errors.push(`POU "${wanted.name}": ${wanted.language} bodies are not applied yet.`)
}

/**
 * Native blocks are driven by entry points the runtime calls, and nothing else
 * checks for them at author time.
 *
 * The editor injects a Python template when a human opens the POU
 * (`monaco/index.tsx`), so a hand-written block has them by default. A POU
 * authored here never sees that template: bare top-level statements run once at
 * import and then never again, so the block compiles, uploads and silently does
 * nothing — indistinguishable from a wiring fault.
 *
 * C/C++ is checked later by `preprocessPous`, but reporting it here names the
 * POU while the author still has the spec in front of them.
 */
function checkNativeStructure(language: string, text: string): string | null {
  if (language === 'python') {
    const hasLoop = /^\s*def\s+block_loop\s*\(/m.test(text)
    const hasInit = /^\s*def\s+block_init\s*\(/m.test(text)
    if (!hasLoop || !hasInit) {
      const missing = [!hasInit ? 'block_init()' : '', !hasLoop ? 'block_loop()' : ''].filter(Boolean).join(' and ')
      return (
        `a Python body must define ${missing}. The runtime calls block_init() once and block_loop() about ` +
        'every 100 ms; top-level statements run once at import and never again.'
      )
    }
  }
  if (language === 'cpp') {
    const hasSetup = /\bvoid\s+setup\s*\(/.test(text)
    const hasLoop = /\bvoid\s+loop\s*\(/.test(text)
    if (!hasSetup || !hasLoop) {
      const missing = [!hasSetup ? 'setup()' : '', !hasLoop ? 'loop()' : ''].filter(Boolean).join(' and ')
      return `a C/C++ body must define ${missing}.`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/**
 * Build the store's array type from the spec's `dimensions`.
 *
 * The store keeps an array twice over: `value` as the rendered IEC text and
 * `data` as the structured bounds. Both are derived here, exactly as the GUI's
 * array modal builds them (`variables-table/elements/array-modal.tsx`) — asking
 * a caller for the rendered string as well as the bounds is asking for the two
 * to disagree.
 */
function toVariableType(type: SpecVariable['type']): PLCVariable['type'] {
  if (type.definition !== 'array' || !type.dimensions) return type as PLCVariable['type']

  const element = type.value.trim()
  const isBaseType = (baseTypeEnum.options as readonly string[]).includes(element.toUpperCase())
  return {
    definition: 'array',
    value: `ARRAY [${type.dimensions.join(', ')}] OF ${element.toUpperCase()}`,
    data: {
      baseType: { definition: isBaseType ? 'base-type' : 'user-data-type', value: element },
      dimensions: type.dimensions.map((dimension) => ({ dimension })),
    },
  } as PLCVariable['type']
}

function toVariable(spec: SpecVariable, fallbackClass: 'local' | 'global'): PLCVariable {
  return {
    name: spec.name,
    class: spec.class ?? fallbackClass,
    type: toVariableType(spec.type),
    location: spec.location ?? '',
    documentation: spec.documentation ?? '',
    ...(spec.initialValue !== undefined ? { initialValue: spec.initialValue } : {}),
    ...(spec.debug !== undefined ? { debug: spec.debug } : {}),
    ...(spec.flag !== undefined ? { flag: spec.flag } : {}),
  } as unknown as PLCVariable
}

/**
 * Retain settings, written after the board is set.
 *
 * `setDeviceBoard` swaps the per-board persistent-storage bucket, so writing
 * these first would put them on the outgoing board and lose them.
 */
function applyPersistentStorage(spec: ApplySpec, changes: PlannedChange[]): void {
  const wanted = spec.device?.persistentStorage
  if (!wanted) return

  // `setPersistentStorage`, not a hand-merge through `setDeviceDefinitions`: it
  // materialises the defaults, keeps `persistentStorageByBoard` in step with the
  // flat view, and marks the device dirty — without that last part the save
  // writes the device file without this in it.
  openPLCStoreBase.getState().deviceActions.setPersistentStorage({
    enabled: wanted.enabled,
    ...(wanted.path !== undefined ? { path: wanted.path } : {}),
    ...(wanted.flushSeconds !== undefined ? { flushSeconds: wanted.flushSeconds } : {}),
  })

  const applied = openPLCStoreBase.getState().deviceDefinitions.configuration.persistentStorage
  changes.push({
    kind: 'device',
    action: 'update',
    name: `persistentStorage = ${applied?.enabled ? `every ${applied.flushSeconds}s` : 'off'}`,
  })
}

function applyVariables(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const pou of spec.pous ?? []) {
    for (const wanted of pou.variables ?? []) {
      const state: Store = openPLCStoreBase.getState()
      const target = state.project.data.pous.find((entry) => entry.name === pou.name)
      if (!target) continue

      const existing = (target.interface?.variables ?? []).findIndex((entry) => entry.name === wanted.name)
      if (existing >= 0) {
        state.projectActions.updateVariable({
          scope: 'local',
          associatedPou: pou.name,
          rowId: existing,
          data: toVariable(wanted, 'local'),
        })
        changes.push({ kind: 'variable', action: 'update', name: `${pou.name}.${wanted.name}` })
        continue
      }

      const response = state.projectActions.createVariable({
        scope: 'local',
        associatedPou: pou.name,
        data: toVariable(wanted, 'local'),
      })
      if (!response.ok) {
        errors.push(`variable "${pou.name}.${wanted.name}": ${response.message ?? 'could not be created'}`)
        continue
      }
      changes.push(namedChange(response, pou.name, wanted.name, errors))
    }
  }
}

function applyGlobalVariables(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.globalVariables ?? []) {
    const state: Store = openPLCStoreBase.getState()
    const globals = state.project.data.configurations.resource.globalVariables ?? []
    const existing = globals.findIndex((entry) => entry.name === wanted.name)

    if (existing >= 0) {
      state.projectActions.updateVariable({ scope: 'global', rowId: existing, data: toVariable(wanted, 'global') })
      changes.push({ kind: 'variable', action: 'update', name: wanted.name })
      continue
    }

    const response = state.projectActions.createVariable({ scope: 'global', data: toVariable(wanted, 'global') })
    if (!response.ok) {
      errors.push(`global variable "${wanted.name}": ${response.message ?? 'could not be created'}`)
      continue
    }
    changes.push(namedChange(response, null, wanted.name, errors))
  }
}

/**
 * Report the name the store actually used.
 *
 * `createVariableValidation` auto-increments a colliding name — ask for `Motor`
 * on a POU that already has one and you get `Motor1`, silently. A spec that
 * later references `Motor` would then be referencing a variable that does not
 * exist, so the rename is surfaced rather than swallowed.
 */
function namedChange(
  response: { data?: unknown },
  pouName: string | null,
  asked: string,
  errors: string[],
): PlannedChange {
  const actual = (response.data as { name?: string } | undefined)?.name
  const label = pouName ? `${pouName}.${asked}` : asked
  if (actual && actual !== asked) {
    // An error, not a note. A spec is a declaration: if the store cannot give
    // the name that was asked for, nothing downstream referring to it resolves,
    // and `--prune` then deletes the renamed variable because the spec never
    // mentions that name. The combination is silent and destructive.
    //
    // `createVariable` throws the REASON away and returns only the new name, so
    // ask the same gate the store asked and quote what it says. Guessing the
    // cause sends the reader to the wrong place: a library block, a POU, a
    // device alias and a reserved word all land here.
    const why =
      pouName === null
        ? elementNameCollision(openPLCStoreBase.getState(), asked, 'resource-global')
        : `POU "${pouName}" already has a variable called "${asked}"`
    const reason = (why ?? 'The name is already claimed').replace(/\.?$/, '.')
    errors.push(
      `variable "${label}" could not take that name — the store renamed it to "${actual}". ` +
        `${reason} Rename it in the spec.`,
    )
  }
  return { kind: 'variable', action: 'create', name: label }
}

// ---------------------------------------------------------------------------
// Tasks and instances
// ---------------------------------------------------------------------------

function applyTasks(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.tasks ?? []) {
    const state: Store = openPLCStoreBase.getState()
    const tasks = state.project.data.configurations.resource.tasks
    const existing = tasks.findIndex((task) => task.name === wanted.name)

    if (existing >= 0) {
      state.projectActions.updateTask({ data: wanted, rowId: existing })
      changes.push({ kind: 'task', action: 'update', name: wanted.name })
      continue
    }

    const response = state.projectActions.createTask({ data: wanted })
    if (!response.ok) {
      errors.push(`task "${wanted.name}": ${response.message ?? 'could not be created'}`)
      continue
    }
    changes.push({ kind: 'task', action: 'create', name: wanted.name })
  }
}

function applyInstances(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const wanted of spec.instances ?? []) {
    const state: Store = openPLCStoreBase.getState()
    const resource = state.project.data.configurations.resource

    // `createInstance` validates neither of these, and a dangling reference
    // only surfaces much later as an IEC compile error.
    if (!resource.tasks.some((task) => task.name === wanted.task)) {
      errors.push(`instance "${wanted.name}": no task named "${wanted.task}".`)
      continue
    }
    const program = state.project.data.pous.find((pou) => pou.name === wanted.program)
    if (!program || program.pouType !== 'program') {
      errors.push(`instance "${wanted.name}": "${wanted.program}" is not a program in this project.`)
      continue
    }

    const existing = resource.instances.findIndex((instance) => instance.name === wanted.name)
    if (existing >= 0) {
      state.projectActions.updateInstance({ data: wanted, rowId: existing })
      changes.push({ kind: 'instance', action: 'update', name: wanted.name })
      continue
    }

    const response = state.projectActions.createInstance({ data: wanted })
    if (!response.ok) {
      errors.push(`instance "${wanted.name}": ${response.message ?? 'could not be created'}`)
      continue
    }
    changes.push({ kind: 'instance', action: 'create', name: wanted.name })
  }
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

/**
 * Remove what the spec does not mention.
 *
 * Only entities the spec's own sections cover: a spec with no `pous` key is not
 * a request to delete every POU, so a section that is absent prunes nothing.
 * `pouActions.delete`, never `deleteRequest` — the latter opens a modal and
 * would hang here forever.
 */
function prune(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  if (spec.pous) {
    const wanted = new Set(spec.pous.map((pou) => pou.name))
    for (const pou of [...openPLCStoreBase.getState().project.data.pous]) {
      if (wanted.has(pou.name)) continue
      openPLCStoreBase.getState().pouActions.delete(pou.name)
      changes.push({ kind: 'pou', action: 'delete', name: pou.name })
    }
  }

  if (spec.dataTypes) {
    const wanted = new Set(spec.dataTypes.map((type) => type.name))
    for (const type of [...openPLCStoreBase.getState().project.data.dataTypes]) {
      if (wanted.has(type.name)) continue
      openPLCStoreBase.getState().projectActions.deleteDatatype(type.name)
      changes.push({ kind: 'data-type', action: 'delete', name: type.name })
    }
  }

  if (spec.instances) {
    const wanted = new Set(spec.instances.map((instance) => instance.name))
    const resource = openPLCStoreBase.getState().project.data.configurations.resource
    // Backwards: every delete is by row index, so removing from the end keeps
    // the remaining indices valid.
    for (let row = resource.instances.length - 1; row >= 0; row -= 1) {
      const instance = resource.instances[row]
      if (wanted.has(instance.name)) continue
      openPLCStoreBase.getState().projectActions.deleteInstance({ rowId: row })
      changes.push({ kind: 'instance', action: 'delete', name: instance.name })
    }
  }

  if (spec.tasks) {
    const wanted = new Set(spec.tasks.map((task) => task.name))
    const resource = openPLCStoreBase.getState().project.data.configurations.resource
    for (let row = resource.tasks.length - 1; row >= 0; row -= 1) {
      const task = resource.tasks[row]
      if (wanted.has(task.name)) continue
      openPLCStoreBase.getState().projectActions.deleteTask({ rowId: row })
      changes.push({ kind: 'task', action: 'delete', name: task.name })
    }
  }

  pruneVariables(spec, changes, errors)
}

/**
 * Drop variables the spec stopped declaring.
 *
 * Without this a `describe` -> edit -> `apply` round trip can only ever add:
 * a variable removed from the document stays in the project, and a renamed one
 * leaves its old declaration behind.
 *
 * Same rule as everything else here — an absent key prunes nothing, so a POU
 * with no `variables` section keeps the ones it has.
 */
function pruneVariables(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  for (const pou of spec.pous ?? []) {
    if (!pou.variables) continue
    const wanted = new Set(pou.variables.map((variable) => variable.name.toLowerCase()))
    const current = openPLCStoreBase.getState().project.data.pous.find((entry) => entry.name === pou.name)
    for (const variable of [...(current?.interface?.variables ?? [])]) {
      if (wanted.has(variable.name.toLowerCase())) continue
      openPLCStoreBase
        .getState()
        .projectActions.deleteVariable({ scope: 'local', associatedPou: pou.name, variableName: variable.name })
      changes.push({ kind: 'variable', action: 'delete', name: `${pou.name}.${variable.name}` })
    }
  }

  if (spec.globalVariables) {
    const wanted = new Set(spec.globalVariables.map((variable) => variable.name.toLowerCase()))
    const globals = openPLCStoreBase.getState().project.data.configurations.resource.globalVariables ?? []
    for (const variable of [...globals]) {
      if (wanted.has(variable.name.toLowerCase())) continue
      // Not forced: a global a POU still declares VAR_EXTERNAL would otherwise
      // be cascade-deleted out of that POU's interface, which the spec did not
      // ask for. Report the conflict and leave both in place.
      const response = openPLCStoreBase
        .getState()
        .projectActions.deleteVariable({ scope: 'global', variableName: variable.name })
      if (!response.ok) {
        const referencing = (response.data as { referencingPous?: string[] } | undefined)?.referencingPous ?? []
        errors.push(
          `global variable "${variable.name}" cannot be pruned: ` +
            `${referencing.join(', ') || 'a POU'} still declares it VAR_EXTERNAL.`,
        )
        continue
      }
      changes.push({ kind: 'variable', action: 'delete', name: variable.name })
    }
  }

  for (const list of spec.globalVariableLists ?? []) {
    const wanted = new Set(list.variables.map((variable) => variable.name.toLowerCase()))
    const current = openPLCStoreBase
      .getState()
      .project.data.globalVariableLists?.find((entry) => entry.name === list.name)
    for (const variable of [...(current?.variables ?? [])]) {
      if (wanted.has(variable.name.toLowerCase())) continue
      openPLCStoreBase
        .getState()
        .projectActions.deleteVariable({ scope: 'global', associatedList: list.name, variableName: variable.name })
      changes.push({ kind: 'variable', action: 'delete', name: `${list.name}.${variable.name}` })
    }
  }
}
