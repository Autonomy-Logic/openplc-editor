import { produce } from 'immer'
import type { StoreApi } from 'zustand'
import { StateCreator } from 'zustand'

import type {
  ModbusIOPoint,
  OpcUaServerConfig,
  PLCServer,
  PLCVariable,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
} from '../../../../middleware/shared/ports/types'
import {
  buildAddressPool,
  buildAliasRegistry,
  nextFreeAddress,
  syncVariableAliases as syncVariablesPure,
} from '../../../../middleware/shared/utils/iec-address'
import { resolveTargetCapabilities } from '../../../../middleware/shared/utils/target-capabilities'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { isLegalIdentifier } from '../../../utils/keywords'
import { DEFAULT_BUFFER_MAPPING } from '../../../utils/modbus/generate-modbus-slave-config'
import { getExtensionFromLanguage, getFolderFromPouType } from '../../../utils/PLC/pou-file-extensions'
import type { ProjectResponse, ProjectSlice, ProjectSliceRoot } from './types'
import { getVariableBasedOnRowIdOrVariableId } from './utils'
import { createVariableValidation, updateVariableValidation } from './validation/variables'

const ok = (data?: unknown): ProjectResponse => ({ ok: true, data })
const fail = (message: string, title?: string): ProjectResponse => ({ ok: false, message, title })

// Default S7Comm configurations
const DEFAULT_S7COMM_SERVER_SETTINGS: S7CommServerSettings = {
  enabled: false,
  bindAddress: '0.0.0.0',
  port: 102,
  maxClients: 32,
  workIntervalMs: 100,
  sendTimeoutMs: 3000,
  recvTimeoutMs: 3000,
  pingTimeoutMs: 10000,
  pduSize: 480,
}

const DEFAULT_S7COMM_PLC_IDENTITY: S7CommPlcIdentity = {
  name: 'OpenPLC Runtime',
  moduleType: 'CPU 315-2 PN/DP',
  serialNumber: 'S C-OPENPLC01',
  copyright: 'OpenPLC Project',
  moduleName: 'OpenPLC',
}

const DEFAULT_S7COMM_LOGGING: S7CommLogging = {
  logConnections: true,
  logDataAccess: false,
  logErrors: true,
}

// Default OPC-UA configuration
const DEFAULT_OPCUA_SERVER_CONFIG: OpcUaServerConfig = {
  server: {
    enabled: false,
    name: 'OpenPLC OPC UA Server',
    applicationUri: 'urn:openplc:opcua:server',
    productUri: 'urn:openplc:runtime',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc/opcua',
  },
  securityProfiles: [
    {
      id: 'default-insecure',
      name: 'insecure',
      enabled: true,
      securityPolicy: 'None',
      securityMode: 'None',
      authMethods: ['Anonymous'],
    },
  ],
  security: {
    serverCertificateStrategy: 'auto_self_signed',
    serverCertificateCustom: null,
    serverPrivateKeyCustom: null,
    trustedClientCertificates: [],
  },
  users: [],
  cycleTimeMs: 100,
  addressSpace: {
    namespaceUri: 'urn:openplc:opcua:namespace',
    nodes: [],
  },
}

function initializeServerProtocolConfig(serverData: PLCServer): PLCServer {
  if (serverData.protocol === 'modbus-tcp' && !serverData.modbusSlaveConfig) {
    return {
      ...serverData,
      modbusSlaveConfig: { enabled: false, networkInterface: '0.0.0.0', port: 502 },
    }
  }
  if (serverData.protocol === 's7comm' && !serverData.s7commSlaveConfig) {
    return {
      ...serverData,
      s7commSlaveConfig: {
        server: { ...DEFAULT_S7COMM_SERVER_SETTINGS },
        plcIdentity: { ...DEFAULT_S7COMM_PLC_IDENTITY },
        dataBlocks: [],
        logging: { ...DEFAULT_S7COMM_LOGGING },
      },
    }
  }
  if (serverData.protocol === 'opcua' && !serverData.opcuaServerConfig) {
    return {
      ...serverData,
      opcuaServerConfig: { ...DEFAULT_OPCUA_SERVER_CONFIG },
    }
  }
  return serverData
}

function getFunctionCodeInfo(functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'): {
  type: string
  iecPrefix: string
  isBit: boolean
} {
  switch (functionCode) {
    case '1':
      return { type: 'Digital Input (Coil Status)', iecPrefix: '%IX', isBit: true }
    case '2':
      return { type: 'Digital Input (Discrete Input)', iecPrefix: '%IX', isBit: true }
    case '3':
      return { type: 'Analog Input (Holding Register)', iecPrefix: '%IW', isBit: false }
    case '4':
      return { type: 'Analog Input (Input Register)', iecPrefix: '%IW', isBit: false }
    case '5':
      return { type: 'Digital Output (Single Coil)', iecPrefix: '%QX', isBit: true }
    case '6':
      return { type: 'Analog Output (Single Register)', iecPrefix: '%QW', isBit: false }
    case '15':
      return { type: 'Digital Output (Multiple Coils)', iecPrefix: '%QX', isBit: true }
    case '16':
      return { type: 'Analog Output (Multiple Registers)', iecPrefix: '%QW', isBit: false }
    default:
      return { type: 'Unknown', iecPrefix: '%MW', isBit: false }
  }
}

function generateIOPoints(
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16',
  length: number,
  groupName: string,
  /* Pool of every claim active for the current target. The bulk
   * allocator threads its own `pending` set alongside the pool so
   * each new point in the same batch sees the prior batch picks
   * without needing to rebuild the pool inside the loop. */
  pool: Parameters<typeof nextFreeAddress>[0],
  pending: Set<string>,
): ModbusIOPoint[] {
  const { type, iecPrefix, isBit } = getFunctionCodeInfo(functionCode)
  const points: ModbusIOPoint[] = []

  for (let i = 0; i < length; i++) {
    const iecLocation = nextFreeAddress(pool, iecPrefix, isBit, undefined, pending)
    pending.add(iecLocation)
    points.push({ id: `${groupName}_${i}`, name: `${groupName}_${i}`, type, iecLocation, alias: '' })
  }

  return points
}

// ---------------------------------------------------------------------------
// Variables-text ⇄ variables-table reconcile helpers
// ---------------------------------------------------------------------------

// `createVariable`, `updateVariable`, and `deleteVariable` below are
// reachable from outside the variables-editor itself — block drops,
// autocomplete "Add variable", block deletion, node type changes, etc.
// When that POU's variables editor is in text mode, the in-memory
// `pou.interface.variables` array and the `editor.variable.code`
// buffer are two views of the same data.  Mutating the array
// directly would diverge them: switching back to table mode would
// reparse the (stale) text and clobber the just-added variable.
//
// Each external mutation runs three steps to keep them in lockstep:
//
//   1. **Reconcile** (`reconcileVariablesText`) — if the editor is in
//      code mode, parse the text and replace the variables array with
//      the parsed result.  Mirrors what the explicit text→table mode
//      switch does, minus the rename/type-change dialogs (those are
//      polish for an explicit user mode switch, not an implicit
//      reconcile triggered by an unrelated diagram action).  If the
//      text doesn't parse, refuse the mutation — the call site
//      surfaces the failure via toast through the standard
//      `{ok: false, title, message}` return shape.
//   2. **Mutate** — apply the requested change to the variables array.
//   3. **Regenerate** (`regenerateVariablesText`) — if the editor is
//      in code mode, regenerate `editor.variable.code` from the new
//      variables so Monaco shows the new state immediately.
//
// Project save / load paths intentionally do NOT call these — the
// serializer roundtrip preserves invalid text verbatim (see
// `parse-project-files`), and we only need to reconcile when an
// external mutation is requested.

type ProjectSetState = StoreApi<ProjectSliceRoot>['setState']
type ProjectGetState = () => ProjectSliceRoot

const reconcileVariablesText = (
  pouName: string | undefined,
  getState: ProjectGetState,
  setState: ProjectSetState,
): ProjectResponse => {
  if (!pouName) return ok()
  const state = getState()
  const editorModel =
    state.editor.meta.name === pouName ? state.editor : state.editors.find((e) => e.meta.name === pouName)
  // Only the editors that expose a per-POU variables panel
  // participate.  Other editor types (datatype, device, server, etc.)
  // never own a variables-text view.
  if (!editorModel || (editorModel.type !== 'plc-textual' && editorModel.type !== 'plc-graphical')) return ok()
  if (editorModel.variable.display !== 'code') return ok()
  const code = editorModel.variable.code
  if (typeof code !== 'string') return ok()

  const pou = state.project.data.pous.find((p) => p.name === pouName)
  const currentVariables = pou?.interface?.variables ?? []
  // Buffer is a verbatim serialisation of the current variables —
  // user hasn't typed since the last sync, nothing to reconcile.
  if (code === generateIecVariablesToString(currentVariables)) return ok()

  try {
    const parsed = parseIecStringToVariables(
      code,
      state.project.data.pous,
      state.project.data.dataTypes,
      state.libraries,
    )
    setState(
      produce((slice: ProjectSlice) => {
        const target = slice.project.data.pous.find((p) => p.name === pouName)
        if (target?.interface) target.interface.variables = parsed
      }),
    )
    return ok()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parse error.'
    return fail(message, 'Variables table is invalid')
  }
}

const regenerateVariablesText = (pouName: string | undefined, getState: ProjectGetState): void => {
  if (!pouName) return
  const state = getState()
  const editorModel =
    state.editor.meta.name === pouName ? state.editor : state.editors.find((e) => e.meta.name === pouName)
  if (!editorModel || (editorModel.type !== 'plc-textual' && editorModel.type !== 'plc-graphical')) return
  if (editorModel.variable.display !== 'code') return
  const pou = state.project.data.pous.find((p) => p.name === pouName)
  const newText = generateIecVariablesToString(pou?.interface?.variables ?? [])
  state.editorActions.updateModelVariablesForName(pouName, { display: 'code', code: newText })
}

const createProjectSlice: StateCreator<ProjectSliceRoot, [], [], ProjectSlice> = (setState, getState) => ({
  project: {
    meta: { name: '', type: 'plc-project', path: '' },
    data: {
      dataTypes: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      servers: [],
      remoteDevices: [],
      libraries: [],
    },
  },
  pendingDeletions: [],

  projectActions: {
    // -----------------------------------------------------------------------
    // Project state
    // -----------------------------------------------------------------------
    setProject: (state) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project = state
        }),
      )
    },
    setPous: (pous) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.pous = pous
        }),
      )
    },
    clearProjects: () => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project = {
            meta: { name: '', type: 'plc-project', path: '' },
            data: {
              dataTypes: [],
              pous: [],
              configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
              servers: [],
              remoteDevices: [],
              libraries: [],
            },
          }
          slice.pendingDeletions = []
        }),
      )
    },
    clearPendingDeletions: () => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.pendingDeletions = []
        }),
      )
    },

    // -----------------------------------------------------------------------
    // Meta
    // -----------------------------------------------------------------------
    updateMetaName: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.meta.name = name
        }),
      )
    },
    updateMetaPath: (path) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.meta.path = path
        }),
      )
    },
    updateLibraryManifest: (content) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.libraryManifest = content
        }),
      )
    },

    // -----------------------------------------------------------------------
    // POU
    // -----------------------------------------------------------------------
    createPou: (dto) => {
      const existing = getState().project.data.pous.find((p) => p.name === dto.data.name)
      if (existing) return fail('POU already exists')

      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.pous.push({
            name: dto.data.name,
            pouType: dto.type,
            interface: {
              returnType: dto.type === 'function' ? (dto.data as { returnType?: string }).returnType : undefined,
              variables: dto.data.variables ?? [],
            },
            body: dto.data.body,
            documentation: dto.data.documentation,
          })
        }),
      )
      return ok()
    },
    updatePou: ({ name, content }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (pou) pou.body = content
        }),
      )
    },
    deletePou: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (pou) {
            const folder = getFolderFromPouType(pou.pouType)
            const ext = getExtensionFromLanguage(pou.body.language)
            slice.pendingDeletions.push(`pous/${folder}/${name}${ext}`)
          }
          slice.project.data.pous = slice.project.data.pous.filter((p) => p.name !== name)
        }),
      )
    },
    updatePouDocumentation: (name, documentation) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (pou) pou.documentation = documentation
        }),
      )
    },
    updatePouReturnType: (name, returnType) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (pou?.interface) pou.interface.returnType = returnType
        }),
      )
    },
    clearPouVariablesText: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name) as { variablesText?: string } | undefined
          if (pou) delete pou.variablesText
        }),
      )
    },
    updatePouName: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === oldName)
          if (pou) {
            // Queue the OLD path for deletion. The next save serializes the
            // POU under its new path; without this, the old file lingers in
            // S3 (orphan-cleanup catches it) but the version-control badge
            // wouldn't see the deletion event and would over-count by 1.
            const folder = getFolderFromPouType(pou.pouType)
            const ext = getExtensionFromLanguage(pou.body.language)
            slice.pendingDeletions.push(`pous/${folder}/${oldName}${ext}`)
            pou.name = newName
          }
        }),
      )
    },
    applyPouSnapshot: (name, variables, body) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (!pou) return
          pou.body = body
          /* istanbul ignore next -- defensive: interface is always present when POU exists */
          if (pou.interface) pou.interface.variables = variables
        }),
      )
    },

    // -----------------------------------------------------------------------
    // Variables
    // -----------------------------------------------------------------------
    createVariable: (dto) => {
      const { scope, associatedPou, rowToInsert } = dto
      let { data } = dto

      const [isNameLegal, reason] = isLegalIdentifier(data.name)
      if (!isNameLegal) {
        return fail(`'${data.name}' ${reason}`, 'Illegal Variable Name')
      }

      if (scope === 'local') {
        const reconcile = reconcileVariablesText(associatedPou, getState, setState)
        if (!reconcile.ok) return reconcile
      }

      let response: ProjectResponse = { ok: true }
      setState(
        produce((slice: ProjectSlice) => {
          // Resolve the target variables array (local POU or global)
          let variables: PLCVariable[] | undefined
          if (scope === 'local' && associatedPou) {
            const pou = slice.project.data.pous.find((p) => p.name === associatedPou)
            if (!pou?.interface) {
              response = fail('POU not found')
              return
            }
            variables = pou.interface.variables
          } else {
            variables = slice.project.data.configurations.resource.globalVariables
          }

          // Validate and auto-increment name/location
          data = { ...data, ...createVariableValidation(variables, data) }

          // Insert or append
          if (rowToInsert !== undefined) {
            const filtered = scope === 'local' ? variables.filter((v) => v.name !== 'OUT') : variables
            filtered.splice(rowToInsert, 0, data)
            if (scope === 'local' && associatedPou) {
              const pou = slice.project.data.pous.find((p) => p.name === associatedPou)!
              pou.interface!.variables = [...filtered]
            }
          } else {
            variables.push(data)
          }
          response.data = data
        }),
      )
      if (scope === 'local' && response.ok) regenerateVariablesText(associatedPou, getState)
      return response
    },
    setPouVariables: ({ pouName, variables }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === pouName)
          if (pou?.interface) pou.interface.variables = variables
        }),
      )
      return ok()
    },
    setGlobalVariables: ({ variables }) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.configurations.resource.globalVariables = variables
        }),
      )
      return ok()
    },
    updateVariable: ({ scope, associatedPou, rowId, variableId, data: updates }) => {
      if (scope === 'local') {
        const reconcile = reconcileVariablesText(associatedPou, getState, setState)
        if (!reconcile.ok) return reconcile
      }

      let response: ProjectResponse = { ok: true }

      // Auto-adopt path: whenever the location changes, look up the
      // alias registry and patch updates.alias to match the new
      // address. If the address has an alias, the variable adopts it
      // (cell shows the alias name, Phase 4 sync will keep the
      // location current as the alias moves). If not, the alias
      // clears — re-typing a now-orphaned location intentionally
      // drops the stale alias label too. Done outside `produce` so
      // we read the live store state including pinMapping + caps.
      let aliasOverride: { alias: string | undefined } | undefined
      if (typeof updates.location === 'string') {
        const live = getState()
        const boardInfo = live.deviceAvailableOptions.availableBoards.get(
          live.deviceDefinitions.configuration.deviceBoard ?? '',
        )
        const ioMapping =
          (live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined)?.entries ?? []
        const pool = buildAddressPool(
          {
            pinMapping: { pins: live.deviceDefinitions.pinMapping.pins },
            vendorIoMapping: { entries: ioMapping },
            remoteDevices: live.project.data.remoteDevices,
          },
          resolveTargetCapabilities(boardInfo),
        )
        const registry = buildAliasRegistry(pool)
        aliasOverride = { alias: registry.byAddress.get(updates.location)?.alias }
      }

      setState(
        produce((slice: ProjectSlice) => {
          // Resolve the target variables array (local POU or global)
          let variables: PLCVariable[] | undefined
          if (scope === 'local' && associatedPou) {
            const pou = slice.project.data.pous.find((p) => p.name === associatedPou)
            if (!pou?.interface) {
              response = fail('POU not found')
              return
            }
            variables = pou.interface.variables
          } else {
            variables = slice.project.data.configurations.resource.globalVariables
          }

          const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
          if (!found) {
            response = { ok: false, title: 'Variable not found' }
            return
          }

          const validationResponse = updateVariableValidation(variables, updates, found.variable)
          if (!validationResponse.ok) {
            response = validationResponse
            return
          }

          variables[found.index] = {
            ...variables[found.index],
            ...updates,
            ...(aliasOverride ?? {}),
            ...(validationResponse.data ? validationResponse.data : {}),
          }
          response.data = variables[found.index]
        }),
      )
      if (scope === 'local' && response.ok) regenerateVariablesText(associatedPou, getState)
      return response
    },
    getVariable: ({ scope, associatedPou, rowId, variableId }) => {
      const variables =
        scope === 'local' && associatedPou
          ? getState().project.data.pous.find((p) => p.name === associatedPou)?.interface?.variables
          : getState().project.data.configurations.resource.globalVariables
      if (!variables) return undefined

      const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
      return found?.variable
    },
    deleteVariable: ({ scope, associatedPou, rowId, variableId, variableName }) => {
      if (scope === 'local') {
        const reconcile = reconcileVariablesText(associatedPou, getState, setState)
        if (!reconcile.ok) return reconcile
      }

      if (scope === 'global') {
        const state = getState()
        const globalVars = state.project.data.configurations.resource.globalVariables

        let variableToDelete: PLCVariable | undefined
        if (variableName) {
          variableToDelete = globalVars.find((v) => v.name.toLowerCase() === variableName.toLowerCase())
        } else {
          variableToDelete = getVariableBasedOnRowIdOrVariableId(globalVars, rowId, variableId)?.variable
        }

        if (variableToDelete) {
          const externalReferences = state.project.data.pous.filter((pou) =>
            pou.interface?.variables?.some(
              (v) => v.class === 'external' && v.name.toLowerCase() === variableToDelete.name.toLowerCase(),
            ),
          )

          if (externalReferences.length > 0) {
            const pouNames = externalReferences.map((pou) => pou.name).join(', ')
            return fail(
              `The global variable "${variableToDelete.name}" is referenced by external variables in the following POUs: ${pouNames}. Please remove these references before deleting the global variable.`,
              'Cannot Delete Global Variable',
            )
          }
        }
      }

      let response: ProjectResponse = { ok: true }
      setState(
        produce((slice: ProjectSlice) => {
          const variables =
            scope === 'local' && associatedPou
              ? slice.project.data.pous.find((p) => p.name === associatedPou)?.interface?.variables
              : slice.project.data.configurations.resource.globalVariables
          if (!variables) {
            response = fail('Variable container not found')
            return
          }

          if (variableName) {
            const idx = variables.findIndex((v) => v.name.toLowerCase() === variableName.toLowerCase())
            if (idx === -1) {
              response = fail(`Variable "${variableName}" not found`, 'Variable not found')
              return
            }
            variables.splice(idx, 1)
            return
          }
          const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
          if (!found) {
            response = fail('Variable not found')
            return
          }
          variables.splice(found.index, 1)
        }),
      )
      if (scope === 'local' && response.ok) regenerateVariablesText(associatedPou, getState)
      return response
    },
    rearrangeVariables: ({ scope, associatedPou, rowId, variableId, newIndex }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const variables =
            scope === 'local' && associatedPou
              ? slice.project.data.pous.find((p) => p.name === associatedPou)?.interface?.variables
              : slice.project.data.configurations.resource.globalVariables
          if (!variables) return

          const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
          if (!found) return
          const [item] = variables.splice(found.index, 1)
          variables.splice(newIndex, 0, item)
        }),
      )
    },

    syncVariableAliases: () => {
      // Build pool + registry once from the live state before entering
      // produce so we don't read draft proxies inside the registry
      // build.
      const live = getState()
      const boardInfo = live.deviceAvailableOptions.availableBoards.get(
        live.deviceDefinitions.configuration.deviceBoard ?? '',
      )
      const ioMapping =
        (live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
          | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
          | undefined)?.entries ?? []
      const pool = buildAddressPool(
        {
          pinMapping: { pins: live.deviceDefinitions.pinMapping.pins },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: live.project.data.remoteDevices,
        },
        resolveTargetCapabilities(boardInfo),
      )
      const registry = buildAliasRegistry(pool)

      // Conflicts are unreachable under normal editor flows because
      // the editor always assigns addresses uniquely. They can
      // appear when a project file has been hand-edited or migrated
      // incorrectly — silent first-wins is the worst failure mode,
      // so surface them in the console panel.
      if (pool.conflicts.length > 0) {
        const sample = pool.conflicts
          .slice(0, 5)
          .map((c) => `${c.address} (${c.sources.map((s) => s.kind).join(', ')})`)
          .join('; ')
        const overflow = pool.conflicts.length > 5 ? ` (+${pool.conflicts.length - 5} more)` : ''
        live.consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `Address pool reports ${pool.conflicts.length} conflicting claim(s): ${sample}${overflow}. The first source wins; later ones lose their address binding.`,
        })
      }

      let adopted = 0
      let refreshed = 0
      let orphaned = 0

      setState(
        produce((slice: ProjectSlice) => {
          for (const pou of slice.project.data.pous) {
            if (!pou.interface?.variables) continue
            const result = syncVariablesPure(pou.interface.variables, registry)
            adopted += result.report.adopted.length
            refreshed += result.report.refreshed.length
            orphaned += result.report.orphaned.length
            // Mutate in place to preserve draft semantics.
            for (let i = 0; i < result.variables.length; i++) {
              pou.interface.variables[i] = result.variables[i]
            }
          }

          const globals = slice.project.data.configurations.resource.globalVariables
          if (globals) {
            const result = syncVariablesPure(globals, registry)
            adopted += result.report.adopted.length
            refreshed += result.report.refreshed.length
            orphaned += result.report.orphaned.length
            for (let i = 0; i < result.variables.length; i++) {
              globals[i] = result.variables[i]
            }
          }
        }),
      )

      return { adopted, refreshed, orphaned }
    },

    // -----------------------------------------------------------------------
    // Data types
    // -----------------------------------------------------------------------
    createDatatype: (dto) => {
      const existing = getState().project.data.dataTypes.find((d) => d.name === dto.data.name)
      if (existing) return fail('Data type already exists')

      setState(
        produce((slice: ProjectSlice) => {
          if (dto.rowToInsert !== undefined) {
            slice.project.data.dataTypes.splice(dto.rowToInsert, 0, dto.data)
          } else {
            slice.project.data.dataTypes.push(dto.data)
          }
        }),
      )
      return ok()
    },
    deleteDatatype: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.dataTypes = slice.project.data.dataTypes.filter((d) => d.name !== name)
        }),
      )
    },
    updateDatatype: (name, data) => {
      setState(
        produce((slice: ProjectSlice) => {
          const idx = slice.project.data.dataTypes.findIndex((d) => d.name === name)
          if (idx === -1) return
          if (data) {
            slice.project.data.dataTypes[idx] = data
          }
        }),
      )
    },
    createArrayDimension: ({ name, derivation: _derivation }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const dt = slice.project.data.dataTypes.find((d) => d.name === name)
          if (dt && dt.derivation === 'array') {
            dt.dimensions.push({ dimension: '' })
          }
        }),
      )
    },
    rearrangeStructureVariables: ({ associatedDataType, rowId, newIndex }) => {
      setState(
        produce((slice: ProjectSlice) => {
          if (!associatedDataType) return
          const dt = slice.project.data.dataTypes.find((d) => d.name === associatedDataType)
          if (!dt || dt.derivation !== 'structure') return
          const [item] = dt.variable.splice(rowId, 1)
          if (item) dt.variable.splice(newIndex, 0, item)
        }),
      )
    },
    applyDatatypeSnapshot: (name, data) => {
      setState(
        produce((slice: ProjectSlice) => {
          const idx = slice.project.data.dataTypes.findIndex((d) => d.name === name)
          if (idx !== -1) slice.project.data.dataTypes[idx] = data
        }),
      )
    },

    // -----------------------------------------------------------------------
    // Tasks
    // -----------------------------------------------------------------------
    createTask: (dto) => {
      const tasks = getState().project.data.configurations.resource.tasks
      if (tasks.some((t) => t.name === dto.data.name)) return fail('Task already exists')

      setState(
        produce((slice: ProjectSlice) => {
          const tasks = slice.project.data.configurations.resource.tasks
          if (dto.rowToInsert !== undefined) {
            tasks.splice(dto.rowToInsert, 0, dto.data)
          } else {
            tasks.push(dto.data)
          }
        }),
      )
      return ok()
    },
    setTasks: ({ tasks }) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.configurations.resource.tasks = tasks
        }),
      )
      return ok()
    },
    updateTask: (dto) => {
      setState(
        produce((slice: ProjectSlice) => {
          const tasks = slice.project.data.configurations.resource.tasks
          if (dto.rowId >= 0 && dto.rowId < tasks.length) {
            tasks[dto.rowId] = { ...tasks[dto.rowId], ...dto.data }
          }
        }),
      )
      return ok()
    },
    deleteTask: ({ rowId }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const tasks = slice.project.data.configurations.resource.tasks
          if (rowId >= 0 && rowId < tasks.length) tasks.splice(rowId, 1)
        }),
      )
    },
    rearrangeTasks: ({ rowId, newIndex }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const tasks = slice.project.data.configurations.resource.tasks
          if (rowId < 0 || rowId >= tasks.length) return
          const [item] = tasks.splice(rowId, 1)
          tasks.splice(newIndex, 0, item)
        }),
      )
    },

    // -----------------------------------------------------------------------
    // Instances
    // -----------------------------------------------------------------------
    createInstance: (dto) => {
      const instances = getState().project.data.configurations.resource.instances
      if (instances.some((i) => i.name === dto.data.name)) return fail('Instance already exists')

      setState(
        produce((slice: ProjectSlice) => {
          const instances = slice.project.data.configurations.resource.instances
          if (dto.rowToInsert !== undefined) {
            instances.splice(dto.rowToInsert, 0, dto.data)
          } else {
            instances.push(dto.data)
          }
        }),
      )
      return ok()
    },
    setInstances: ({ instances }) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.configurations.resource.instances = instances
        }),
      )
      return ok()
    },
    updateInstance: (dto) => {
      setState(
        produce((slice: ProjectSlice) => {
          const instances = slice.project.data.configurations.resource.instances
          if (dto.rowId >= 0 && dto.rowId < instances.length) {
            instances[dto.rowId] = { ...instances[dto.rowId], ...dto.data }
          }
        }),
      )
      return ok()
    },
    deleteInstance: ({ rowId }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const instances = slice.project.data.configurations.resource.instances
          if (rowId >= 0 && rowId < instances.length) instances.splice(rowId, 1)
        }),
      )
    },
    rearrangeInstances: ({ rowId, newIndex }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const instances = slice.project.data.configurations.resource.instances
          if (rowId < 0 || rowId >= instances.length) return
          const [item] = instances.splice(rowId, 1)
          instances.splice(newIndex, 0, item)
        }),
      )
    },

    // -----------------------------------------------------------------------
    // Servers
    // -----------------------------------------------------------------------
    createServer: (dto) => {
      const servers = getState().project.data.servers ?? []
      if (servers.some((s) => s.name === dto.data.name)) return fail('Server already exists')

      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.servers) slice.project.data.servers = []
          slice.project.data.servers.push(initializeServerProtocolConfig(dto.data))
        }),
      )
      return ok()
    },
    deleteServer: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.servers) return
          slice.pendingDeletions.push(`devices/servers/${name}.json`)
          slice.project.data.servers = slice.project.data.servers.filter((s) => s.name !== name)
        }),
      )
      return ok()
    },
    updateServerName: (name, newName) => {
      /* istanbul ignore next -- defensive: servers array initialized during createServer */
      const servers = getState().project.data.servers ?? []
      if (servers.some((s) => s.name === newName)) return fail('Server name already exists')

      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (server) {
            // See `updatePouName` — queue old path so the version-control
            // badge doesn't over-count the rename.
            slice.pendingDeletions.push(`devices/servers/${name}.json`)
            server.name = newName
          }
        }),
      )
      return ok()
    },
    updateServerConfig: (name, config) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.modbusSlaveConfig) return
          if (config.enabled !== undefined) server.modbusSlaveConfig.enabled = config.enabled
          if (config.networkInterface !== undefined) server.modbusSlaveConfig.networkInterface = config.networkInterface
          if (config.port !== undefined) server.modbusSlaveConfig.port = config.port
          if (config.bufferMapping) {
            const base = server.modbusSlaveConfig.bufferMapping ?? DEFAULT_BUFFER_MAPPING
            server.modbusSlaveConfig.bufferMapping = {
              holdingRegisters: { ...base.holdingRegisters, ...config.bufferMapping.holdingRegisters },
              coils: { ...base.coils, ...config.bufferMapping.coils },
              discreteInputs: { ...base.discreteInputs, ...config.bufferMapping.discreteInputs },
              inputRegisters: { ...base.inputRegisters, ...config.bufferMapping.inputRegisters },
            }
          }
        }),
      )
      return ok()
    },

    // -----------------------------------------------------------------------
    // S7Comm
    // -----------------------------------------------------------------------
    updateS7CommServerSettings: (name, settings) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig) return
          Object.assign(server.s7commSlaveConfig.server, settings)
        }),
      )
      return ok()
    },
    updateS7CommPlcIdentity: (name, identity) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig?.plcIdentity) return
          Object.assign(server.s7commSlaveConfig.plcIdentity, identity)
        }),
      )
      return ok()
    },
    addS7CommDataBlock: (name, block) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig) return
          server.s7commSlaveConfig.dataBlocks.push(block)
        }),
      )
      return ok()
    },
    updateS7CommDataBlock: (name, index, block) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig) return
          const blocks = server.s7commSlaveConfig.dataBlocks
          if (index >= 0 && index < blocks.length) {
            Object.assign(blocks[index], block)
          }
        }),
      )
      return ok()
    },
    removeS7CommDataBlock: (name, index) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig) return
          const blocks = server.s7commSlaveConfig.dataBlocks
          if (index >= 0 && index < blocks.length) blocks.splice(index, 1)
        }),
      )
      return ok()
    },
    updateS7CommSystemArea: (name, _area, config) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig) return
          const slaveConfig = server.s7commSlaveConfig as unknown as Record<string, unknown>
          const existing = slaveConfig[_area]
          if (existing && typeof existing === 'object') {
            Object.assign(existing, config)
          } else {
            slaveConfig[_area] = { enabled: false, sizeBytes: 1, ...config }
          }
        }),
      )
      return ok()
    },
    updateS7CommLogging: (name, logging) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.s7commSlaveConfig?.logging) return
          Object.assign(server.s7commSlaveConfig.logging, logging)
        }),
      )
      return ok()
    },

    // -----------------------------------------------------------------------
    // OPC-UA
    // -----------------------------------------------------------------------
    updateOpcUaServerConfig: (name, config) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          // The UI wraps sub-object updates (e.g. { server: { enabled: true } })
          // while top-level fields (e.g. { cycleTimeMs: 100 }) are passed directly.
          const { server: serverUpdates, ...topLevelUpdates } = config
          if (serverUpdates && typeof serverUpdates === 'object') {
            Object.assign(server.opcuaServerConfig.server, serverUpdates)
          }
          if (Object.keys(topLevelUpdates).length > 0) {
            Object.assign(server.opcuaServerConfig, topLevelUpdates)
          }
        }),
      )
      return ok()
    },
    addOpcUaSecurityProfile: (name, profile) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.securityProfiles.push(profile)
        }),
      )
      return ok()
    },
    updateOpcUaSecurityProfile: (name, profileId, updates) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          const profile = server.opcuaServerConfig.securityProfiles.find((p) => p.id === profileId)
          if (profile) Object.assign(profile, updates)
        }),
      )
      return ok()
    },
    removeOpcUaSecurityProfile: (name, profileId) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.securityProfiles = server.opcuaServerConfig.securityProfiles.filter(
            (p) => p.id !== profileId,
          )
        }),
      )
      return ok()
    },
    addOpcUaUser: (name, user) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.users.push(user)
        }),
      )
      return ok()
    },
    updateOpcUaUser: (name, userId, updates) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          const user = server.opcuaServerConfig.users.find((u) => u.id === userId)
          if (user) Object.assign(user, updates)
        }),
      )
      return ok()
    },
    removeOpcUaUser: (name, userId) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.users = server.opcuaServerConfig.users.filter((u) => u.id !== userId)
        }),
      )
      return ok()
    },
    updateOpcUaServerCertificateStrategy: (name, strategy, certificate, privateKey) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.security.serverCertificateStrategy = strategy
          if (certificate !== undefined) server.opcuaServerConfig.security.serverCertificateCustom = certificate
          if (privateKey !== undefined) server.opcuaServerConfig.security.serverPrivateKeyCustom = privateKey
        }),
      )
      return ok()
    },
    addOpcUaTrustedCertificate: (name, cert) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.security.trustedClientCertificates.push(cert)
        }),
      )
      return ok()
    },
    removeOpcUaTrustedCertificate: (name, certId) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.security.trustedClientCertificates =
            server.opcuaServerConfig.security.trustedClientCertificates.filter((c) => c.id !== certId)
        }),
      )
      return ok()
    },
    updateOpcUaAddressSpaceNamespace: (name, namespace) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.addressSpace.namespaceUri = namespace
        }),
      )
      return ok()
    },
    addOpcUaNode: (name, node) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.addressSpace.nodes.push(node)
        }),
      )
      return ok()
    },
    updateOpcUaNode: (name, nodeId, updates) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          const node = server.opcuaServerConfig.addressSpace.nodes.find((n) => n.id === nodeId)
          if (node) Object.assign(node, updates)
        }),
      )
      return ok()
    },
    removeOpcUaNode: (name, nodeId) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
          server.opcuaServerConfig.addressSpace.nodes = server.opcuaServerConfig.addressSpace.nodes.filter(
            (n) => n.id !== nodeId,
          )
        }),
      )
      return ok()
    },

    // -----------------------------------------------------------------------
    // Remote devices
    // -----------------------------------------------------------------------
    createRemoteDevice: (dto) => {
      const devices = getState().project.data.remoteDevices ?? []
      if (devices.some((d) => d.name === dto.data.name)) return fail('Remote device already exists')

      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.remoteDevices) slice.project.data.remoteDevices = []
          const device = { ...dto.data }
          if (device.protocol === 'modbus-tcp' && !device.modbusTcpConfig) {
            device.modbusTcpConfig = { host: '127.0.0.1', port: 502, slaveId: 1, timeout: 1000, ioGroups: [] }
          }
          slice.project.data.remoteDevices.push(device)

          // EtherCAT bus is driven by a dedicated thread inside the
          // runtime plugin, not by an injected IEC task. Nothing to do
          // here on add/rename/delete.
        }),
      )
      return ok()
    },
    deleteRemoteDevice: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.remoteDevices) return
          slice.pendingDeletions.push(`devices/remote/${name}.json`)
          slice.project.data.remoteDevices = slice.project.data.remoteDevices.filter((d) => d.name !== name)
        }),
      )
      return ok()
    },
    updateRemoteDeviceName: (name, newName) => {
      /* istanbul ignore next -- defensive: remoteDevices array initialized during createRemoteDevice */
      const devices = getState().project.data.remoteDevices ?? []
      if (devices.some((d) => d.name === newName)) return fail('Device name already exists')

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === name)
          if (!device) return

          // See `updatePouName` — queue old path so the version-control
          // badge doesn't over-count the rename.
          slice.pendingDeletions.push(`devices/remote/${name}.json`)

          device.name = newName
        }),
      )
      return ok()
    },
    updateRemoteDeviceConfig: (name, config) => {
      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === name)
          if (!device?.modbusTcpConfig) return
          if (config.host !== undefined) device.modbusTcpConfig.host = config.host
          if (config.port !== undefined) device.modbusTcpConfig.port = config.port
          if (config.slaveId !== undefined) device.modbusTcpConfig.slaveId = config.slaveId
          if (config.timeout !== undefined) device.modbusTcpConfig.timeout = config.timeout
        }),
      )
      return ok()
    },
    addIOGroup: (deviceName, group) => {
      // Read producer state from the live store before entering produce
      // so the pool reflects every active source (pin-mapping, VPP,
      // every Modbus / EtherCAT remote device — including this one's
      // existing groups, which must not be reclaimed) under the
      // current target's capabilities.
      const live = getState()
      const boardInfo = live.deviceAvailableOptions.availableBoards.get(
        live.deviceDefinitions.configuration.deviceBoard ?? '',
      )
      const ioMapping =
        (live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
          | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
          | undefined)?.entries ?? []

      const pool = buildAddressPool(
        {
          pinMapping: { pins: live.deviceDefinitions.pinMapping.pins },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: live.project.data.remoteDevices,
        },
        resolveTargetCapabilities(boardInfo),
      )

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return

          const pending = new Set<string>()
          const ioPoints = generateIOPoints(group.functionCode, group.length, group.name, pool, pending)
          device.modbusTcpConfig.ioGroups.push({ ...group, ioPoints })
        }),
      )
      return ok()
    },
    updateIOGroup: (deviceName, groupId, updates) => {
      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          const group = device.modbusTcpConfig.ioGroups.find((g) => g.id === groupId)
          if (group) Object.assign(group, updates)
        }),
      )
      return ok()
    },
    deleteIOGroup: (deviceName, groupId) => {
      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          device.modbusTcpConfig.ioGroups = device.modbusTcpConfig.ioGroups.filter((g) => g.id !== groupId)
        }),
      )
      return ok()
    },
    updateIOPointAlias: (deviceName, groupId, pointId, alias) => {
      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          const group = device.modbusTcpConfig.ioGroups.find((g) => g.id === groupId)
          if (!group) return
          const point = group.ioPoints?.find((p) => p.id === pointId)
          if (point) point.alias = alias
        }),
      )
      // Producer mutation: refresh variables that were bound to the
      // old alias (or that now resolve to the new one).
      getState().projectActions.syncVariableAliases()
      return ok()
    },
    updateEthercatConfig: (deviceName, ethercatConfig) => {
      let response = ok()
      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = slice.project.data.remoteDevices.find((d) => d.name === deviceName)
          if (!device) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          if (device.protocol !== 'ethercat') {
            response = { ok: false, message: 'Device is not an EtherCAT device' }
            return
          }
          device.ethercatConfig = ethercatConfig
          // Bus timing now lives entirely in masterConfig (cycleTimeUs +
          // taskPriority); the runtime plugin's bus thread reads them
          // directly. No IEC task needs syncing.
        }),
      )
      return response
    },
  },
})

export { createProjectSlice }
