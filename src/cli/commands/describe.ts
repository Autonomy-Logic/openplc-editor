/**
 * `openplc-cli describe` — read a project back out in the shape `apply` takes.
 *
 * Round-tripping is the point: an agent reads a project, edits the document it
 * gets, and applies it. Anything this cannot express is flagged rather than
 * silently flattened — a body that came back subtly different from what is on
 * disk would be data loss disguised as a feature.
 *
 * `--libraries` emits the block catalogue with exact pin names. That is the
 * single most valuable payload here: without it an agent guesses whether the
 * pin is `PT` or `PRESET`, and a guess produces a diagram that looks right and
 * does not compile.
 */

import { openPLCStoreBase } from '@root/frontend/store'
import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'
import type { PLCDataType, PLCPou, PLCVariable } from '@root/middleware/shared/ports/types'

import { boolFlag, type ParsedArgs, stringFlag } from '../args'
import { describeFbdBody } from '../describe/fbd'
import { describeLadderBody } from '../describe/ladder'
import { describeProtocols } from '../describe/protocol'
import { ErrorCode, ExitCode } from '../exit-codes'
import type { CliResult, Reporter } from '../output'
import { loadProject, unreadableProtocolFilesMessage } from '../project/load'

const TEXTUAL = new Set(['st', 'il', 'python', 'cpp'])

export async function runDescribe(args: ParsedArgs, reporter: Reporter): Promise<CliResult> {
  const projectPath = args.positionals[0] ?? stringFlag(args, 'project')
  if (!projectPath) {
    return reporter.failure(
      { code: ErrorCode.InvalidArgument, message: 'describe needs the path of a project.' },
      ExitCode.Usage,
    )
  }

  const loaded = await loadProject(projectPath)
  if (!loaded.success) {
    return reporter.failure({ code: ErrorCode.ProjectNotFound, message: loaded.error }, ExitCode.NotFound)
  }
  for (const warning of loaded.project.warnings) reporter.progress(warning)

  const unreadable = unreadableProtocolFilesMessage(loaded.project)
  if (unreadable) {
    return reporter.failure(
      {
        code: ErrorCode.ProtocolFileUnreadable,
        message: unreadable,
        details: loaded.project.unreadableProtocolFiles,
      },
      ExitCode.TargetError,
    )
  }

  const state = openPLCStoreBase.getState()
  const onlyPou = stringFlag(args, 'pou')
  const pous = state.project.data.pous.filter((pou) => !onlyPou || pou.name === onlyPou)
  // Every POU in the project, not just the filtered view — a block can call one
  // this listing leaves out.
  const userPouNames = new Set(state.project.data.pous.map((pou) => pou.name))

  if (onlyPou && pous.length === 0) {
    return reporter.failure(
      { code: ErrorCode.TargetError, message: `This project has no POU named "${onlyPou}".` },
      ExitCode.NotFound,
    )
  }

  // Read-only, and deliberately outside `spec`: allocation decides these, so a
  // spec carrying them would stop round-tripping whenever allocation differed.
  let protocolAddresses: Record<string, unknown>[] = []

  const spec: Record<string, unknown> = {
    specVersion: 1,
    pous: pous.map((pou) => describePou(pou, state.libraries.system, userPouNames)),
  }

  // A single-POU view is a lens on one body, not a project document — emitting
  // the configuration alongside it would invite applying a partial spec with
  // `--prune` and deleting everything else.
  if (!onlyPou) {
    spec.device = {
      board: loaded.project.board,
      ...(loaded.project.communicationPort ? { communicationPort: loaded.project.communicationPort } : {}),
      ...(state.deviceDefinitions.configuration.runtimeIpAddress
        ? { runtimeIpAddress: state.deviceDefinitions.configuration.runtimeIpAddress }
        : {}),
      ...(state.deviceDefinitions.configuration.persistentStorage
        ? { persistentStorage: state.deviceDefinitions.configuration.persistentStorage }
        : {}),
    }
    spec.libraries = (state.project.data.libraries ?? []).map((ref) => ({ name: ref.name, version: ref.version }))
    spec.globalVariableLists = (state.project.data.globalVariableLists ?? []).map((list) => ({
      name: list.name,
      ...(list.qualifier ? { qualifier: list.qualifier } : {}),
      ...(list.documentation ? { documentation: list.documentation } : {}),
      variables: list.variables.map(describeVariable),
    }))
    spec.dataTypes = state.project.data.dataTypes.map(describeDataType).filter(Boolean)
    spec.globalVariables = (state.project.data.configurations.resource.globalVariables ?? []).map(describeVariable)
    spec.tasks = state.project.data.configurations.resource.tasks
    spec.instances = state.project.data.configurations.resource.instances

    const protocols = describeProtocols(state.project.data.servers ?? [], state.project.data.remoteDevices ?? [])
    spec.servers = protocols.servers
    spec.remoteDevices = protocols.remoteDevices
    protocolAddresses = protocols.protocolAddresses
  }

  const payload: Record<string, unknown> = {
    ok: true,
    project: loaded.project.name,
    board: loaded.project.board,
    spec,
  }
  if (protocolAddresses.length > 0) payload.protocolAddresses = protocolAddresses
  if (boolFlag(args, 'libraries')) payload.libraries = state.libraries.system.map(describeLibrary)

  return reporter.success(payload, () => render(payload))
}

function describePou(
  pou: PLCPou,
  libraries: readonly SystemLibrary[],
  userPouNames: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: pou.name,
    kind: pou.pouType,
    language: pou.body.language,
  }
  if (pou.interface?.returnType) out.returnType = pou.interface.returnType
  if (pou.documentation) out.documentation = pou.documentation
  out.variables = (pou.interface?.variables ?? []).map(describeVariable)

  if (TEXTUAL.has(pou.body.language)) {
    out.body = { text: String(pou.body.value ?? '') }
    return out
  }

  const described =
    pou.body.language === 'ld'
      ? describeLadderBody(pou.body.value, libraries, userPouNames)
      : pou.body.language === 'fbd'
        ? describeFbdBody(pou.body.value, libraries, userPouNames)
        : null

  if (described?.ok) {
    out.body = described.body
  } else {
    // The diagram cannot be written back as this grammar. Saying so is the
    // whole contract — `apply` refuses to overwrite a body it cannot express,
    // rather than flattening it on the next round trip.
    out.bodyLossy = true
    out.bodyLossyReason = described?.reason ?? `${pou.body.language} bodies cannot be described yet`
  }
  return out
}

function describeVariable(variable: PLCVariable): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: variable.name,
    class: variable.class,
    type: describeVariableType(variable.type),
  }
  if (variable.flag) out.flag = variable.flag
  if (variable.location) out.location = variable.location
  if (variable.initialValue !== undefined && variable.initialValue !== null) out.initialValue = variable.initialValue
  if (variable.documentation) out.documentation = variable.documentation
  return out
}

/**
 * An array reads back as its ELEMENT type plus the bounds, which is what `apply`
 * takes. Reporting the store's rendered `value` ("ARRAY [0..3] OF INT") would
 * hand back a document that cannot be applied: `apply` derives that text from
 * `dimensions`, so it would end up nested inside itself on the next pass.
 */
function describeVariableType(type: PLCVariable['type']): Record<string, unknown> {
  if (type.definition !== 'array' || !type.data) {
    return { definition: type.definition, value: type.value }
  }
  return {
    definition: 'array',
    value: type.data.baseType.value,
    dimensions: type.data.dimensions.map((entry) => entry.dimension),
  }
}

function describeDataType(dataType: PLCDataType): Record<string, unknown> | null {
  if (dataType.derivation === 'enumerated') {
    return {
      name: dataType.name,
      derivation: 'enumerated',
      values: dataType.values.map((value) => value.description),
      ...(dataType.initialValue ? { initialValue: dataType.initialValue } : {}),
    }
  }
  if (dataType.derivation === 'structure') {
    return {
      name: dataType.name,
      derivation: 'structure',
      variables: dataType.variable.map((member) => ({
        name: member.name,
        type: { definition: member.type.definition, value: member.type.value },
        ...(member.documentation ? { documentation: member.documentation } : {}),
      })),
    }
  }
  return {
    name: dataType.name,
    derivation: 'array',
    baseType: { definition: dataType.baseType.definition, value: dataType.baseType.value },
    dimensions: dataType.dimensions.map((entry) => entry.dimension),
    ...(dataType.initialValue ? { initialValue: dataType.initialValue } : {}),
  }
}

/** The catalogue an agent needs to place a block without guessing its pins. */
function describeLibrary(library: SystemLibrary): Record<string, unknown> {
  return {
    name: library.name,
    version: library.version,
    blocks: library.pous.map((pou) => ({
      /** Exactly what `apply` wants in `call`. */
      call: `system/${library.name}/${pou.name}`,
      name: pou.name,
      type: pou.type,
      ...(pou.extensible ? { extensible: true } : {}),
      ...(pou.documentation ? { documentation: pou.documentation } : {}),
      pins: pou.variables.map((variable) => ({
        name: variable.name,
        class: variable.class,
        type: variable.type.value,
      })),
    })),
  }
}

function render(payload: Record<string, unknown>): string {
  const spec = payload.spec as { pous?: Array<Record<string, unknown>> }
  const lines = [`${String(payload.project)} (${String(payload.board)})`]
  for (const pou of spec.pous ?? []) {
    const variables = (pou.variables as unknown[] | undefined)?.length ?? 0
    const lossy = pou.bodyLossy ? '  [body not describable]' : ''
    lines.push(`  ${String(pou.kind)} ${String(pou.name)} (${String(pou.language)}, ${variables} var)${lossy}`)
  }
  const libraries = payload.libraries as Array<{ name: string; blocks: unknown[] }> | undefined
  if (libraries) {
    lines.push('', 'Libraries')
    for (const library of libraries) lines.push(`  ${library.name} — ${library.blocks.length} block(s)`)
  }
  lines.push('', 'Use --json for the full document.')
  return lines.join('\n')
}
