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
  describeSource,
  nextFreeAddress,
  validateAliasEdit,
} from '../../../../middleware/shared/utils/iec-address'
import {
  buildAliasIndex,
  channelKey,
  ethercatConsumerId,
  type IecAddressRegistry,
  migrateToRegistry,
  modbusConsumerId,
  recalculate as recalculateRegistry,
  resolveLocation,
  restoreAliasesFromMemory,
  unpinAllocatableChannels,
} from '../../../../middleware/shared/utils/iec-address/registry'
import type { TargetCapabilities } from '../../../../middleware/shared/utils/target-capabilities'
import { resolveTargetCapabilities } from '../../../../middleware/shared/utils/target-capabilities'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
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
  /* Points that previously occupied this group (edit flow). Their
   * aliases are carried over positionally so resizing / editing a
   * group doesn't wipe the aliases the user attached to each slot. */
  existingPoints: ModbusIOPoint[] = [],
): ModbusIOPoint[] {
  const { type, iecPrefix, isBit } = getFunctionCodeInfo(functionCode)
  const points: ModbusIOPoint[] = []

  for (let i = 0; i < length; i++) {
    const iecLocation = nextFreeAddress(pool, iecPrefix, isBit, undefined, pending)
    pending.add(iecLocation)
    points.push({
      id: `${groupName}_${i}`,
      name: `${groupName}_${i}`,
      type,
      iecLocation,
      alias: existingPoints[i]?.alias ?? '',
    })
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

// ---------------------------------------------------------------------------
// Central IEC address recalculation (registry-owned)
// ---------------------------------------------------------------------------

/** Consumer kinds the central recalculation reallocates. Pin mapping is fixed
 *  (hardware addresses), so pins are treated as constraints (seeded + kept
 *  pinned) that VPP / Modbus / EtherCAT allocate around; pins join in their
 *  own commit. */
const ALLOCATED_KINDS: ReadonlySet<string> = new Set(['vpp-io', 'modbus-tcp-remote', 'ethercat'])

/** IO-mapping (VPP) entry shape the recalc reads/writes. */
type VppMappingEntry = {
  iecAddress: string
  alias?: string
  slot: number
  channelName: string
  moduleId?: string
  [key: string]: unknown
}

/** Live VPP io-mapping entries (empty when the board has no VPP backplane). */
function readVppEntries(live: ProjectSliceRoot): VppMappingEntry[] {
  return (
    (
      live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
        | { entries?: VppMappingEntry[] }
        | undefined
    )?.entries ?? []
  )
}

/** Map the active target's capabilities to the set of consumer kinds that
 *  participate in allocation. A target without pin mapping / VPP simply
 *  omits those kinds, so their addresses free up and the still-active
 *  producers recompact into the space (project-wide recalc on target
 *  switch). */
function activeKindsFromCapabilities(caps: TargetCapabilities): Set<string> {
  const kinds = new Set<string>()
  if (caps.pinMapping) kinds.add('pin-mapping')
  if (caps.vppIo) kinds.add('vpp-io')
  if (caps.modbusTcpRemote) kinds.add('modbus-tcp-remote')
  if (caps.ethercat) kinds.add('ethercat')
  return kinds
}

/**
 * Build the capability-scoped registry from live producer state: derive
 * consumers (pins/VPP/Modbus/EtherCAT), restore any aliases held in the
 * session memory for channels that reappeared (remove→re-add), then
 * reallocate the `ALLOCATED_KINDS` while keeping the rest pinned as fixed
 * constraints. Read live state (never draft proxies) before `produce`.
 */
function buildIecRegistry(live: ProjectSliceRoot): IecAddressRegistry {
  const board = live.deviceDefinitions.configuration.deviceBoard
  const boardInfo = live.deviceAvailableOptions.availableBoards.get(board ?? '')
  const seeded = migrateToRegistry({
    pinMapping: { pins: live.deviceDefinitions.pinMapping.pinsByBoard[board] ?? [] },
    vendorIoMapping: { entries: readVppEntries(live) },
    remoteDevices: live.project.data.remoteDevices,
  })
  const restored = restoreAliasesFromMemory(seeded, live.iecAliasMemory ?? {})
  const activeKinds = activeKindsFromCapabilities(resolveTargetCapabilities(boardInfo))
  return recalculateRegistry(unpinAllocatableChannels(restored, ALLOCATED_KINDS), { activeKinds }).registry
}

/** Flatten the registry into a `channelKey -> { address, alias }` index for
 *  writing results back onto each producer. */
function indexRegistry(registry: IecAddressRegistry): Map<string, { address?: string; alias: string }> {
  const index = new Map<string, { address?: string; alias: string }>()
  for (const consumer of registry.consumers) {
    for (const channel of consumer.channels) {
      const key = channelKey(consumer.id, channel.channelId)
      index.set(key, { address: registry.assignments[key], alias: channel.alias ?? '' })
    }
  }
  return index
}

/** Write the registry's addresses + (memory-restored) aliases back onto the
 *  Modbus producers' `ioPoints`. Keyed exactly as `migrateToRegistry` built
 *  the consumers, so there is no mapping drift. Runs inside `produce`. */
function applyModbusAddresses(
  remoteDevices: ProjectSlice['project']['data']['remoteDevices'],
  index: ReadonlyMap<string, { address?: string; alias: string }>,
): void {
  if (!remoteDevices) return
  for (const device of remoteDevices) {
    const deviceRef = device.name || 'device'
    const groups = device.modbusTcpConfig?.ioGroups
    if (!groups) continue
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]
      const consumerId = modbusConsumerId(deviceRef, group.id ?? String(g))
      for (const point of group.ioPoints ?? []) {
        const info = index.get(channelKey(consumerId, point.id))
        if (!info) continue
        if (info.address) point.iecLocation = info.address
        point.alias = info.alias
      }
    }
  }
}

/** Write the registry's addresses + aliases back onto the EtherCAT producers'
 *  `channelMappings`. Runs inside `produce`. */
function applyEthercatAddresses(
  remoteDevices: ProjectSlice['project']['data']['remoteDevices'],
  index: ReadonlyMap<string, { address?: string; alias: string }>,
): void {
  if (!remoteDevices) return
  for (const device of remoteDevices) {
    const deviceRef = device.name || 'device'
    const slaves = device.ethercatConfig?.devices
    if (!slaves) continue
    for (const slave of slaves) {
      const consumerId = ethercatConsumerId(deviceRef, slave.name || 'slave')
      for (const mapping of slave.channelMappings ?? []) {
        const info = index.get(channelKey(consumerId, mapping.channelId))
        if (!info) continue
        if (info.address) mapping.iecLocation = info.address
        mapping.alias = info.alias
      }
    }
  }
}

/** Rebuild VPP io-mapping entries with the registry's addresses + aliases.
 *  Pure — returns a new entries array for `setVendorScreenData`. */
function applyVppEntries(
  entries: readonly VppMappingEntry[],
  index: ReadonlyMap<string, { address?: string; alias: string }>,
): VppMappingEntry[] {
  return entries.map((entry) => {
    const info = index.get(channelKey(`vpp-slot-${entry.slot}`, entry.channelName))
    if (!info) return entry
    return { ...entry, iecAddress: info.address ?? entry.iecAddress, alias: info.alias }
  })
}

const reconcileVariablesText = (
  pouName: string | undefined,
  getState: ProjectGetState,
  setState: ProjectSetState,
): ProjectResponse => {
  /* istanbul ignore if -- callers only invoke this in the `scope === 'local'` branch where
     `associatedPou` is required; the `string | undefined` parameter type tracks the union
     used in createVariable / updateVariable, where global-scope callers never reach here */
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
  /* istanbul ignore if -- TS guarantees `code` is a string when `display === 'code'`; this
     runtime guard exists only as a belt-and-braces against the editor-model union drifting */
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
  /* istanbul ignore if -- same callsite guarantees as reconcileVariablesText */
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
  iecAliasMemory: {},

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
          // Session alias-memory is per-project; drop it on a fresh slate so
          // one project's remembered aliases can't leak into the next.
          slice.iecAliasMemory = {}
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

            // Graphical bodies (LD / FBD) carry a `name` field inside
            // `body.value` — that's the key the project-load path uses
            // to seed `ladderFlows[]` / `fbdFlows[]`.  Without syncing
            // it here, the on-disk serialized JSON keeps the OLD name
            // inside the body; on the next project open the flow gets
            // keyed under that stale name and the editor's lookup
            // (which uses the new `pou.name`) misses, rendering an
            // empty canvas.  Textual languages don't embed a name in
            // their body, so the cast guards on the shape.
            if (pou.body.language === 'ld' || pou.body.language === 'fbd') {
              const bodyValue = pou.body.value as { name?: string } | undefined
              if (bodyValue && typeof bodyValue === 'object') {
                bodyValue.name = newName
              }
            }

            // Cascade the rename into the configuration's `instances[]`.
            // Each instance binds an IEC task to a program POU by name;
            // without this cascade, renaming a program POU (e.g. the
            // template-seeded "main") would leave its instance pointing
            // at the now-deleted name, and the IEC compile step would
            // fail with a "program not found" error.  Only program POU
            // renames need to cascade — function-block instances aren't
            // tracked in `configurations.resource.instances`.
            if (pou.pouType === 'program') {
              for (const instance of slice.project.data.configurations.resource.instances) {
                if (instance.program === oldName) instance.program = newName
              }
            }
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

      // Apply the validator's name + location auto-increment against the
      // live store state. The "+ button" UI flow spreads the previous
      // variable as a template, so the validator walks the location forward
      // to the next free slot to avoid duplicate-address compile errors
      // (forum thread "openplc-420-teething-bugs", v4.2.0).
      const sourceVariables =
        scope === 'local' && associatedPou
          ? (getState().project.data.pous.find((p) => p.name === associatedPou)?.interface?.variables ?? [])
          : getState().project.data.configurations.resource.globalVariables
      const validated = createVariableValidation(sourceVariables, data)
      // Single-field location model: `location` is the binding itself — an
      // alias name OR a literal `%addr`. It is stored verbatim (no
      // address→alias auto-adoption); alias→address resolution happens at
      // compile time. The legacy `alias` field is unused.
      data = { ...data, ...validated }

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

      // Single-field location model: `location` is the binding (alias name
      // or literal `%addr`), stored verbatim. No address→alias adoption —
      // a manual literal stays manual even if an alias later appears at that
      // address; alias→address resolution happens at compile time.
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

    /**
     * Cascade-rename every variable whose `location` binds to `oldAlias`
     * so it points at `newAlias` instead.  See the type doc in
     * `project/types.ts` for the full contract — short version: when the
     * user renames the alias on a producer channel (pin mapping, VPP
     * module, Modbus TCP, EtherCAT), the bound variables follow so they
     * don't drop into the orphan (unlocated) path at compile time.
     * Case-sensitive match — the alias registry is case-sensitive, so
     * `location` must equal the producer alias exactly to resolve.
     */
    renameAlias: (oldAlias, newAlias) => {
      const trimmedOld = oldAlias?.trim() ?? ''
      const trimmedNew = newAlias?.trim() ?? ''
      // No-op when there's nothing to rename FROM.  Caller is the IO
      // mapping screen on first-time alias write where there's no
      // prior text to cascade.
      if (trimmedOld.length === 0) return { renamed: 0 }
      // Clearing an alias at its producer (empty newAlias) is a DELETION, not a
      // rename. We deliberately do NOT cascade the empty string onto bound
      // variables: they keep the old alias name in `location`, so they surface
      // as orphaned (amber warning) and resolve to unlocated at compile time —
      // exactly like deleting the whole producer/device. Cascading '' here
      // would silently wipe the user's I/O mapping with no trace, which is the
      // bug this guard prevents.
      if (trimmedNew.length === 0) return { renamed: 0 }
      // True no-op only when the name is unchanged. A CASE change must still
      // cascade — the alias registry is case-sensitive, so `location` has to
      // match the producer alias exactly to resolve at compile time.
      if (trimmedOld === trimmedNew) return { renamed: 0 }

      let renamed = 0
      const cascade = (variable: PLCVariable): PLCVariable => {
        // `location` is the binding: a variable bound to this alias holds the
        // alias NAME in `location`. Manual literal locations start with `%`
        // and never equal a (non-`%`) alias name, so they're left untouched.
        if (variable.location !== trimmedOld) return variable
        renamed += 1
        // A genuine rename (both names non-empty): the bound variable follows
        // to the new alias so it stays located. (The empty-newAlias case is
        // handled above and never reaches here.)
        return { ...variable, location: trimmedNew }
      }

      setState(
        produce((slice: ProjectSlice) => {
          for (const pou of slice.project.data.pous) {
            /* istanbul ignore if -- schema guarantees `interface.variables`; defensive */
            if (!pou.interface?.variables) continue
            for (let i = 0; i < pou.interface.variables.length; i++) {
              pou.interface.variables[i] = cascade(pou.interface.variables[i])
            }
          }
          const globals = slice.project.data.configurations.resource.globalVariables
          if (globals) {
            for (let i = 0; i < globals.length; i++) {
              globals[i] = cascade(globals[i])
            }
          }
        }),
      )

      return { renamed }
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
      // Removing a device frees its addresses — recompact the survivors
      // project-wide (bug #4) and let bound variables follow.
      getState().projectActions.recalculateIecAddresses()
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
          // Transport selector + TCP fields
          if (config.transport !== undefined) device.modbusTcpConfig.transport = config.transport
          if (config.host !== undefined) device.modbusTcpConfig.host = config.host
          if (config.port !== undefined) device.modbusTcpConfig.port = config.port
          // RTU (serial) fields — previously dropped, so editing an RTU remote
          // device silently lost its serial settings on save.
          if (config.serialPort !== undefined) device.modbusTcpConfig.serialPort = config.serialPort
          if (config.baudRate !== undefined) device.modbusTcpConfig.baudRate = config.baudRate
          if (config.parity !== undefined) device.modbusTcpConfig.parity = config.parity
          if (config.stopBits !== undefined) device.modbusTcpConfig.stopBits = config.stopBits
          if (config.dataBits !== undefined) device.modbusTcpConfig.dataBits = config.dataBits
          // Common fields
          if (config.slaveId !== undefined) device.modbusTcpConfig.slaveId = config.slaveId
          if (config.timeout !== undefined) device.modbusTcpConfig.timeout = config.timeout
        }),
      )
      return ok()
    },
    recalculateIecAddresses: () => {
      // Central, capability-scoped recalculation via the IEC address
      // registry. Build the registry from live producer state (VPP + Modbus
      // reallocated; pins/EtherCAT held as fixed constraints), restoring any
      // aliases the session memory remembers for reappeared channels, then
      // write the compacted addresses + aliases back onto every producer.
      //
      // Bound variables need no update here: they reference producer aliases
      // by NAME (stable), so a moved address is picked up automatically at
      // compile time. Only a producer *rename* touches variables — via
      // `renameAlias`, called by the alias editors.
      const live = getState()
      const registry = buildIecRegistry(live)
      const index = indexRegistry(registry)

      // VPP io-mapping lives in device-slice vendorScreenData — write it via
      // the device action so the layouts (which render from the store) update.
      const vppEntries = readVppEntries(live)
      if (vppEntries.length > 0) {
        getState().deviceActions.setVendorScreenData('io-mapping', { entries: applyVppEntries(vppEntries, index) })
      }

      // Modbus ioPoints + EtherCAT channelMappings live in project.data —
      // write them on the draft.
      setState(
        produce((slice: ProjectSlice) => {
          applyModbusAddresses(slice.project.data.remoteDevices, index)
          applyEthercatAddresses(slice.project.data.remoteDevices, index)
        }),
      )
      return ok()
    },
    rememberChannelAlias: (memoryKey, alias) => {
      // Record (or clear) an alias in the session memory keyed by the
      // channel's stable semantic identity, so removing a producer and
      // re-adding the same one restores the alias. Session-scoped — never
      // serialized.
      setState(
        produce((slice: ProjectSlice) => {
          const trimmed = alias.trim()
          if (trimmed.length > 0) slice.iecAliasMemory[memoryKey] = trimmed
          else delete slice.iecAliasMemory[memoryKey]
        }),
      )
      return ok()
    },
    getCompileReadyProjectData: () => {
      // Compile-time alias resolution (editor-side; the compiler/runtime never
      // see aliases). Returns a COPY of the project data with every variable's
      // `location` resolved: an alias name → its current IEC address, a
      // literal `%addr` → verbatim, a missing/orphaned alias → '' (unlocated).
      // The store keeps the alias-name form for display; only this snapshot is
      // resolved.
      const live = getState()
      const aliasIndex = buildAliasIndex(buildIecRegistry(live))
      const data = structuredClone(live.project.data)
      const resolveAll = (variables: PLCVariable[] | undefined): void => {
        if (!variables) return
        for (const variable of variables) variable.location = resolveLocation(variable.location, aliasIndex)
      }
      for (const pou of data.pous) resolveAll(pou.interface?.variables)
      resolveAll(data.configurations?.resource?.globalVariables)
      return data
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
        (
          live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined
        )?.entries ?? []

      const pool = buildAddressPool(
        {
          pinMapping: {
            pins: live.deviceDefinitions.pinMapping.pinsByBoard[live.deviceDefinitions.configuration.deviceBoard] ?? [],
          },
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
      // Central recalculation is the authority for final addresses: it
      // recompacts all remote-device producers project-wide and reconciles
      // bound variables. (The provisional addresses above just seed the
      // point structure/classes.)
      getState().projectActions.recalculateIecAddresses()
      return ok()
    },
    updateIOGroup: (deviceName, groupId, updates) => {
      // Editing a group's length / function code / name must regenerate
      // its I/O points — the previous implementation only `Object.assign`ed
      // the metadata, so the point list (and therefore the effective size
      // shown in the table) never changed (bug: "size stays as originally
      // set"). We regenerate ONLY this group's points here — no
      // project-wide reallocation. To let the group reuse its own freed
      // addresses, the pool is built from every producer EXCEPT this
      // group's current points (all other Modbus groups, pin-mapping, VPP
      // and EtherCAT claims are still honoured). Existing aliases are
      // carried over positionally.
      const live = getState()
      const boardInfo = live.deviceAvailableOptions.availableBoards.get(
        live.deviceDefinitions.configuration.deviceBoard ?? '',
      )
      const ioMapping =
        (
          live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined
        )?.entries ?? []

      // Clone remoteDevices with the edited group's points cleared so its
      // own addresses are free for re-allocation without disturbing the
      // rest of the project.
      const remoteDevicesForPool = live.project.data.remoteDevices?.map((d) =>
        d.name !== deviceName || !d.modbusTcpConfig
          ? d
          : {
              ...d,
              modbusTcpConfig: {
                ...d.modbusTcpConfig,
                ioGroups: d.modbusTcpConfig.ioGroups.map((g) => (g.id === groupId ? { ...g, ioPoints: [] } : g)),
              },
            },
      )

      const pool = buildAddressPool(
        {
          pinMapping: {
            pins: live.deviceDefinitions.pinMapping.pinsByBoard[live.deviceDefinitions.configuration.deviceBoard] ?? [],
          },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: remoteDevicesForPool,
        },
        resolveTargetCapabilities(boardInfo),
      )

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          const group = device.modbusTcpConfig.ioGroups.find((g) => g.id === groupId)
          if (!group) return
          const existingPoints = group.ioPoints ?? []
          Object.assign(group, updates)
          const pending = new Set<string>()
          group.ioPoints = generateIOPoints(group.functionCode, group.length, group.name, pool, pending, existingPoints)
        }),
      )
      getState().projectActions.recalculateIecAddresses()
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
      // Recompact so the groups that followed reclaim the freed addresses.
      getState().projectActions.recalculateIecAddresses()
      return ok()
    },
    updateIOPointAlias: (deviceName, groupId, pointId, alias) => {
      // Phase 1 — write-time alias-uniqueness gate (global, across
      // all producers).  Build a fresh registry from the live state
      // and reject the edit on collision.  See
      // `module-slots-layout.tsx::handleAliasChange` for the longer
      // rationale.
      const live = getState()
      const sourceRef = { kind: 'modbus-tcp-remote' as const, ref: `${deviceName}:${pointId}` }
      const boardInfo = live.deviceAvailableOptions?.availableBoards?.get(
        live.deviceDefinitions?.configuration?.deviceBoard ?? '',
      )
      const ioMapping =
        (
          live.deviceDefinitions?.configuration?.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined
        )?.entries ?? []
      const pool = buildAddressPool(
        {
          pinMapping: {
            pins:
              live.deviceDefinitions?.pinMapping?.pinsByBoard[
                live.deviceDefinitions?.configuration?.deviceBoard ?? ''
              ] ?? [],
          },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: live.project.data.remoteDevices,
        },
        resolveTargetCapabilities(boardInfo),
      )
      const registry = buildAliasRegistry(pool)
      const validation = validateAliasEdit(registry, alias, sourceRef)
      if (!validation.ok) {
        return {
          ok: false,
          title: 'Alias already in use',
          message: `"${alias}" is already assigned to ${describeSource(validation.conflict.source)} (${validation.conflict.address}). Alias names must be unique across all I/O channels.`,
        }
      }

      // Phase 2 — capture the old alias and cascade rename onto
      // bound variables BEFORE writing the new alias so the
      // downstream sync sees variables pointing at the new name and
      // refreshes locations rather than orphaning them.
      const oldAlias =
        live.project.data.remoteDevices
          ?.find((d) => d.name === deviceName)
          ?.modbusTcpConfig?.ioGroups?.find((g) => g.id === groupId)
          ?.ioPoints?.find((p) => p.id === pointId)?.alias ?? ''
      if (oldAlias) {
        getState().projectActions.renameAlias(oldAlias, alias)
      }

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
      return ok()
    },
    updateEthercatConfig: (deviceName, ethercatConfig) => {
      // Capture the previous channel aliases so an alias RENAME cascades onto
      // bound variables (whose `location` holds the alias name). Unlike
      // pin/VPP/Modbus, EtherCAT rewrites its channel list wholesale, so we
      // diff old→new here rather than at a discrete alias editor.
      const prevDevice = getState().project.data.remoteDevices?.find((d) => d.name === deviceName)
      const prevAliasByChannel = new Map<string, string>()
      for (const slave of prevDevice?.ethercatConfig?.devices ?? []) {
        for (const mapping of slave.channelMappings ?? []) {
          if (mapping.alias) prevAliasByChannel.set(`${slave.name}:${mapping.channelId}`, mapping.alias)
        }
      }

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
      if (response.ok) {
        // Cascade any alias rename onto bound variable locations.
        for (const slave of ethercatConfig.devices ?? []) {
          for (const mapping of slave.channelMappings ?? []) {
            const old = prevAliasByChannel.get(`${slave.name}:${mapping.channelId}`)
            if (old && old !== (mapping.alias ?? '')) getState().projectActions.renameAlias(old, mapping.alias ?? '')
          }
        }
        // Channel-mapping changes go through the central registry so EtherCAT
        // addresses are packed alongside VPP/Modbus.
        getState().projectActions.recalculateIecAddresses()
      }
      return response
    },
  },
})

export { createProjectSlice }
