import { produce } from 'immer'
import type { StoreApi } from 'zustand'
import { StateCreator } from 'zustand'

import type {
  BoardInfo,
  ModbusIOPoint,
  OpcUaServerConfig,
  PLCPou,
  PLCServer,
  PLCVariable,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
} from '../../../../middleware/shared/ports/types'
import {
  type AddressPool,
  buildAddressPool,
  buildAliasRegistry,
  describeAliasRejection,
  nextFreeAddress,
  resolveProjectAliases,
  validateAliasEdit,
} from '../../../../middleware/shared/utils/iec-address'
import { planAliasNormalization } from '../../../../middleware/shared/utils/iec-address/normalize-aliases'
import {
  activeKindsFor,
  buildAliasIndex,
  channelKey,
  ethercatConsumerId,
  type IecAddressRegistry,
  migrateToRegistry,
  modbusConsumerId,
  moduleRegistryChannelId,
  recalculate as recalculateRegistry,
  restoreAliasesFromMemory,
  unpinAllocatableChannels,
} from '../../../../middleware/shared/utils/iec-address/registry'
import {
  createDefaultRemoteDeviceConfig,
  type ModbusMasterProfile,
  resolveBoardModbusMasterProfile,
} from '../../../../middleware/shared/utils/modbus-master-profile'
import {
  type AddressProducerCapabilities,
  resolveAddressProducerCapabilities,
} from '../../../../middleware/shared/utils/target-capabilities'
import { renameDataTypeInDataType, renameDataTypeInVariableType } from '../../../utils/data-type-references'
import { buildTypeContext, parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import { isLegalIdentifier } from '../../../utils/keywords'
import { clampIOGroupLength, resolveIOGroupErrorHandling } from '../../../utils/modbus/io-group'
import { parseDataTypeFromText } from '../../../utils/PLC/data-type-declarations'
import { serializeDataTypeToText } from '../../../utils/PLC/data-type-serializer'
import { renameGlobalVariableListInPou } from '../../../utils/PLC/global-variable-list-references'
import { serializeGlobalVariableListToText } from '../../../utils/PLC/global-variable-list-serializer'
import { parseGlobalVariableListFromText } from '../../../utils/PLC/global-variable-list-text-parser'
import { getExtensionFromLanguage, getFolderFromPouType } from '../../../utils/PLC/pou-file-extensions'
import { parseVariableDeclarations } from '../../../utils/PLC/variable-declarations'
import { applyVariablesToText } from '../../../utils/variable-text-edits'
import { elementNameCollision } from '../shared/name-collision'
import type { ProjectResponse, ProjectSlice, ProjectSliceRoot, VariableScope } from './types'
import { getVariableBasedOnRowIdOrVariableId } from './utils'
import { createVariableValidation, updateVariableValidation, validateVariableSet } from './validation/variables'

const ok = (data?: unknown): ProjectResponse => ({ ok: true, data })
const fail = (message: string, title?: string): ProjectResponse => ({ ok: false, message, title })

/** IEC identifiers are case-insensitive — the rule every element-name lookup folds by. */
const nameMatches = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

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
      anonymousRole: 'viewer',
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

/** What a new Modbus server answers on, decided by the target it is created for. */
function seedTransports(live: ProjectSliceRoot): ('rtu' | 'tcp')[] {
  return resolveBoardInfo(live)?.compiler === 'arduino-cli' ? ['rtu'] : ['tcp']
}

function initializeServerProtocolConfig(serverData: PLCServer, transports: ('rtu' | 'tcp')[]): PLCServer {
  if (serverData.protocol === 'modbus-tcp' && !serverData.modbusSlaveConfig) {
    return {
      ...serverData,
      modbusSlaveConfig: { enabled: false, transports, networkInterface: '0.0.0.0', port: 502 },
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
  pool: Parameters<typeof nextFreeAddress>[0],
  pending: Set<string>,
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

/**
 * Points for a bulk import, each seeded with the first address of its class.
 * The registry reads only the class from that seed; `recalculateIecAddresses`
 * then places the whole batch in one pass.
 */
function seedIOPoints(
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16',
  length: number,
  groupName: string,
): ModbusIOPoint[] {
  const { type, iecPrefix, isBit } = getFunctionCodeInfo(functionCode)
  const iecLocation = isBit ? `${iecPrefix}0.0` : `${iecPrefix}0`
  return Array.from({ length }, (_, i) => ({
    id: `${groupName}_${i}`,
    name: `${groupName}_${i}`,
    type,
    iecLocation,
    alias: '',
  }))
}

// `createVariable`, `updateVariable`, and `deleteVariable` below are reachable from outside the variables-editor
// itself — block drops, autocomplete "Add variable", block deletion, node type changes, etc. When that POU's
// variables editor is in text mode, the in-memory `pou.interface.variables` array and the `editor.variable.code`
// buffer are two views of the same data.

type ProjectSetState = StoreApi<ProjectSliceRoot>['setState']
type ProjectGetState = () => ProjectSliceRoot

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

/** The active target's BoardInfo, or `undefined` when the board id doesn't
 *  resolve — a VPP board whose package isn't installed, a project authored on
 *  another machine, or the catalogue not having loaded yet. */
function resolveBoardInfo(live: ProjectSliceRoot): BoardInfo | undefined {
  return live.deviceAvailableOptions.availableBoards.get(live.deviceDefinitions.configuration.deviceBoard ?? '')
}

/** The active target's Modbus master profile; the empty profile when the board does not resolve. */
function resolveMasterProfile(live: ProjectSliceRoot): ModbusMasterProfile {
  return resolveBoardModbusMasterProfile(resolveBoardInfo(live))
}

/** Capabilities for ADDRESS ALLOCATION. */
function allocationCapabilities(live: ProjectSliceRoot): AddressProducerCapabilities {
  return resolveAddressProducerCapabilities(resolveBoardInfo(live))
}

function warnIfTargetUnresolved(live: ProjectSliceRoot): void {
  const board = live.deviceDefinitions.configuration.deviceBoard
  if (resolveBoardInfo(live)) return
  if (live.deviceAvailableOptions.availableBoards.size === 0) return
  console.warn(
    `[iec-address] Target "${board}" did not resolve — allocating with every producer active. ` +
      'Addresses may recompact once the target resolves (e.g. after installing its VPP package).',
  )
}

/**
 * Consumer kinds to scope allocation to, or `undefined` for "every kind" — exactly how `allocateAddresses` reads a
 * missing `activeKinds`.
 */
function activeKindsForAllocation(live: ProjectSliceRoot): Set<string> | undefined {
  const boardInfo = resolveBoardInfo(live)
  return boardInfo ? activeKindsFor(resolveAddressProducerCapabilities(boardInfo)) : undefined
}

/** Provisional address pool for a Modbus IO-group edit — the claims a new or resized group must not land on. */
function buildModbusProducerPool(
  live: ProjectSliceRoot,
  clearGroup?: { deviceName: string; groupId: string },
): AddressPool {
  const board = live.deviceDefinitions.configuration.deviceBoard
  const remoteDevices = clearGroup
    ? live.project.data.remoteDevices?.map((d) =>
        d.name !== clearGroup.deviceName || !d.modbusTcpConfig
          ? d
          : {
              ...d,
              modbusTcpConfig: {
                ...d.modbusTcpConfig,
                ioGroups: d.modbusTcpConfig.ioGroups.map((g) =>
                  g.id === clearGroup.groupId ? { ...g, ioPoints: [] } : g,
                ),
              },
            },
      )
    : live.project.data.remoteDevices

  return buildAddressPool(
    {
      pinMapping: { pins: live.deviceDefinitions.pinMapping.pinsByBoard[board] ?? [] },
      vendorIoMapping: { entries: readVppEntries(live) },
      remoteDevices,
    },
    allocationCapabilities(live),
  )
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
  const seeded = migrateToRegistry({
    pinMapping: { pins: live.deviceDefinitions.pinMapping.pinsByBoard[board] ?? [] },
    vendorIoMapping: { entries: readVppEntries(live) },
    remoteDevices: live.project.data.remoteDevices,
  })
  const restored = restoreAliasesFromMemory(seeded, live.iecAliasMemory ?? {})
  const activeKinds = activeKindsForAllocation(live)
  const unpinned = unpinAllocatableChannels(restored, ALLOCATED_KINDS)
  return recalculateRegistry(unpinned, activeKinds ? { activeKinds } : {}).registry
}

/** Single-entry memo for the `alias → address` index. */
interface AliasIndexCache {
  /** Raw `pinsByBoard[board]` — NOT defaulted to `[]`, which would mint a new
   *  array identity on every call and defeat the cache. */
  pins: ProjectSliceRoot['deviceDefinitions']['pinMapping']['pinsByBoard'][string] | undefined
  vendorScreenData: ProjectSliceRoot['deviceDefinitions']['configuration']['vendorScreenData']
  remoteDevices: ProjectSliceRoot['project']['data']['remoteDevices']
  board: ProjectSliceRoot['deviceDefinitions']['configuration']['deviceBoard']
  aliasMemory: ProjectSliceRoot['iecAliasMemory']
  index: ReadonlyMap<string, string>
}
let aliasIndexCache: AliasIndexCache | null = null

function getMemoizedAliasIndex(live: ProjectSliceRoot): ReadonlyMap<string, string> {
  const board = live.deviceDefinitions.configuration.deviceBoard
  const pins = live.deviceDefinitions.pinMapping.pinsByBoard[board]
  const vendorScreenData = live.deviceDefinitions.configuration.vendorScreenData
  const remoteDevices = live.project.data.remoteDevices
  const aliasMemory = live.iecAliasMemory

  if (
    aliasIndexCache &&
    aliasIndexCache.pins === pins &&
    aliasIndexCache.vendorScreenData === vendorScreenData &&
    aliasIndexCache.remoteDevices === remoteDevices &&
    aliasIndexCache.board === board &&
    aliasIndexCache.aliasMemory === aliasMemory
  ) {
    return aliasIndexCache.index
  }

  const index = buildAliasIndex(buildIecRegistry(live))
  aliasIndexCache = { pins, vendorScreenData, remoteDevices, board, aliasMemory, index }
  return index
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

/** Write the registry's addresses + (memory-restored) aliases back onto the Modbus producers' `ioPoints`. */
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
      for (const module of slave.modules ?? []) {
        for (const mapping of module.channelMappings ?? []) {
          const info = index.get(channelKey(consumerId, moduleRegistryChannelId(module.id, mapping.channelId)))
          if (!info) continue
          if (info.address) mapping.iecLocation = info.address
          mapping.alias = info.alias
        }
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

/**
 * Mirror a shared global's debug (watch) flag across every reference to it.
 *
 * A VAR_EXTERNAL is a pointer to one CONFIGURATION VAR_GLOBAL, so "watch this
 * global in the debugger" is a property of the global, not of any single
 * reference. Toggling the debug icon on the global's own definition or on any
 * POU's VAR_EXTERNAL therefore updates them all in lockstep — so every table
 * shows the same icon state and the global polls/displays as one entity
 * (matching the canonical Config0:<name> key used by the debug tree and poller).
 *
 * Mutates the produce draft in place. Case-insensitive on the global name,
 * consistent with global-variable lookup elsewhere in this slice.
 */
function syncGlobalDebugFlag(slice: ProjectSlice, globalName: string, debug: boolean): void {
  const lower = globalName.toLowerCase()
  for (const g of slice.project.data.configurations.resource.globalVariables) {
    if (g.name.toLowerCase() === lower) g.debug = debug
  }
  for (const pou of slice.project.data.pous) {
    for (const v of pou.interface?.variables ?? []) {
      if (v.class === 'external' && v.name.toLowerCase() === lower) v.debug = debug
    }
  }
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
  if (!editorModel || (editorModel.type !== 'plc-textual' && editorModel.type !== 'plc-graphical')) return ok()
  if (editorModel.variable.display !== 'code') return ok()
  const code = editorModel.variable.code
  /* istanbul ignore if -- TS guarantees `code` is a string when `display === 'code'`; this
     runtime guard exists only as a belt-and-braces against the editor-model union drifting */
  if (typeof code !== 'string') return ok()

  const pou = state.project.data.pous.find((p) => p.name === pouName)
  const currentVariables = pou?.interface?.variables ?? []
  if (code === pou?.variablesText && pou?.variablesTextUnparsed !== true) return ok()
  if (code === generateIecVariablesToString(currentVariables)) return ok()

  try {
    const parsed = parseIecStringToVariables(
      code,
      state.project.data.pous,
      state.project.data.dataTypes,
      state.libraries,
    )
    const validation = validateVariableSet(parsed)
    if (!validation.ok) {
      const duplicate = validation.errors.find((error) => error.title === 'Variable already exists')
      if (duplicate) return fail(duplicate.message, duplicate.title)
    }
    const carried = new Map(currentVariables.map((variable) => [variable.name.toLowerCase(), variable]))
    const merged = parsed.map((variable) => {
      const previous = carried.get(variable.name.toLowerCase())
      if (!previous) return variable
      return {
        ...variable,
        debug: previous.debug ?? false,
        ...(previous.id !== undefined ? { id: previous.id } : {}),
      }
    })

    setState(
      produce((slice: ProjectSlice) => {
        const target = slice.project.data.pous.find((p) => p.name === pouName)
        if (target?.interface) target.interface.variables = merged
      }),
    )
    return ok()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parse error.'
    return fail(message, 'Variables table is invalid')
  }
}

/** Fold a variables mutation back into the declaration text. */
/** A POU's declaration text, the artifact the project file actually stores. */
/** Rewrite `AT <oldAlias>` to `AT <newAlias>` in a POU's declaration text. */
const renameAliasInText = (text: string, oldAlias: string, newAlias: string): string => {
  const escaped = oldAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return text.replace(new RegExp(`(\\b[Aa][Tt]\\s+)${escaped}(?=\\s*(?:;|:=))`, 'g'), `$1${newAlias}`)
}

const readPouVariablesText = (pou: PLCPou): string | undefined => pou.variablesText

const writePouVariablesText = (pouName: string, text: string, getState: ProjectGetState): void => {
  getState().projectActions.setPouVariablesText(pouName, text)
}

const regenerateVariablesText = (pouName: string | undefined, getState: ProjectGetState): void => {
  /* istanbul ignore if -- same callsite guarantees as reconcileVariablesText */
  if (!pouName) return
  const state = getState()
  const pou = state.project.data.pous.find((p) => p.name === pouName)
  if (!pou) return

  const variables = pou.interface?.variables ?? []
  const context = buildTypeContext(state.project.data.pous, state.project.data.dataTypes, state.libraries)

  const editorModel =
    state.editor.meta.name === pouName ? state.editor : state.editors.find((e) => e.meta.name === pouName)
  const variableView =
    editorModel !== undefined && (editorModel.type === 'plc-textual' || editorModel.type === 'plc-graphical')
      ? editorModel.variable
      : undefined
  const inCodeView = variableView?.display === 'code'
  const buffer =
    variableView?.display === 'code' && typeof variableView.code === 'string' ? variableView.code : undefined

  const stored = readPouVariablesText(pou)
  const usableBuffer =
    buffer !== undefined && parseVariableDeclarations(buffer, context).errors.length === 0 ? buffer : undefined
  const current = usableBuffer ?? stored
  const nextText =
    current === undefined ? generateIecVariablesToString(variables) : applyVariablesToText(current, variables, context)

  if (nextText !== stored) writePouVariablesText(pouName, nextText, getState)

  if (!inCodeView || nextText === buffer) return
  if (buffer !== undefined && usableBuffer === undefined) return
  state.editorActions.updateModelVariablesForName(pouName, { display: 'code', code: nextText })
}

// Same contract as the variables pair above, for the `.dt` code view.

const findDatatypeEditorCode = (name: string, getState: ProjectGetState): string | undefined => {
  const state = getState()
  const editorModel = state.editor.meta.name === name ? state.editor : state.editors.find((e) => e.meta.name === name)
  if (editorModel?.type !== 'plc-datatype') return undefined
  if (editorModel.structure.display !== 'code') return undefined
  return editorModel.structure.code
}

const reconcileDatatypeText = (name: string, getState: ProjectGetState, setState: ProjectSetState): ProjectResponse => {
  const code = findDatatypeEditorCode(name, getState)
  if (typeof code !== 'string') return ok()

  const current = getState().project.data.dataTypes.find((d) => d.name === name)
  if (!current) return ok()
  if (code === serializeDataTypeToText(current)) return ok()

  const { dataType, error } = parseDataTypeFromText(code, name)
  if (!dataType) return fail(error ?? 'Unknown parse error.', 'Data type text is invalid')

  setState(
    produce((slice: ProjectSlice) => {
      const idx = slice.project.data.dataTypes.findIndex((d) => d.name === name)
      if (idx !== -1) slice.project.data.dataTypes[idx] = dataType
    }),
  )
  return ok()
}

const regenerateDatatypeText = (name: string, getState: ProjectGetState): void => {
  if (findDatatypeEditorCode(name, getState) === undefined) return
  const state = getState()
  const dataType = state.project.data.dataTypes.find((d) => d.name === name)
  if (!dataType) return
  state.editorActions.updateModelStructureForName(name, {
    display: 'code',
    code: serializeDataTypeToText(dataType),
  })
}

// Same contract again, for the Global Variable List code view.

/** The variables array a scoped action works on. */
const scopedVariables = (
  data: ProjectSlice['project']['data'],
  scope: VariableScope,
  associatedPou?: string,
  associatedList?: string,
): PLCVariable[] | undefined => {
  if (scope === 'local' && associatedPou) return data.pous.find((p) => p.name === associatedPou)?.interface?.variables
  if (scope === 'global-variable-list')
    return (data.globalVariableLists ?? []).find((l) => nameMatches(l.name, associatedList ?? ''))?.variables
  return data.configurations.resource.globalVariables
}

/** Drop a list's preserved declaration text after its members change. */
const clearGlobalVariableListText = (data: ProjectSlice['project']['data'], listName?: string): void => {
  const list = (data.globalVariableLists ?? []).find((l) => nameMatches(l.name, listName ?? ''))
  if (list) delete list.text
}

const findGlobalVariableListEditorCode = (name: string, getState: ProjectGetState): string | undefined => {
  const state = getState()
  const editorModel = state.editor.meta.name === name ? state.editor : state.editors.find((e) => e.meta.name === name)
  if (editorModel?.type !== 'plc-global-variable-list') return undefined
  if (editorModel.structure.display !== 'code') return undefined
  return editorModel.structure.code
}

/** Fold the code view's buffer into the list. */
const reconcileGlobalVariableListText = (
  name: string,
  getState: ProjectGetState,
  setState: ProjectSetState,
): ProjectResponse => {
  const code = findGlobalVariableListEditorCode(name, getState)
  if (typeof code !== 'string') return ok()

  const current = (getState().project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, name))
  if (!current) return ok()
  if (current.text === undefined && code === serializeGlobalVariableListToText(current)) return ok()
  if (code === current.text) return ok()

  const { globalVariableList } = parseGlobalVariableListFromText(code, current.name)

  setState(
    produce((slice: ProjectSlice) => {
      const lists = slice.project.data.globalVariableLists
      const idx = (lists ?? []).findIndex((l) => nameMatches(l.name, name))
      if (idx === -1 || !lists) return
      if (globalVariableList) {
        const { text: _staleText, qualifier: _staleQualifier, ...kept } = lists[idx]
        lists[idx] = { ...kept, ...globalVariableList }
        return
      }
      lists[idx] = { ...lists[idx], text: code }
    }),
  )
  return ok()
}

const regenerateGlobalVariableListText = (name: string, getState: ProjectGetState): void => {
  if (findGlobalVariableListEditorCode(name, getState) === undefined) return
  const state = getState()
  const list = (state.project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, name))
  if (!list) return
  state.editorActions.updateModelStructureForName(name, {
    display: 'code',
    code: list.text ?? serializeGlobalVariableListToText(list),
  })
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
  unparsedDataTypeFiles: [],
  dataTypesNeedMigration: false,
  iecAliasMemory: {},

  projectActions: {
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
          slice.unparsedDataTypeFiles = []
          slice.dataTypesNeedMigration = false
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

    getVppExtension: (packageId, screenId) => {
      return getState().project.data.vppExtensions?.[packageId]?.[screenId]
    },
    setVppExtension: (packageId, screenId, data) => {
      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.vppExtensions) slice.project.data.vppExtensions = {}
          if (!slice.project.data.vppExtensions[packageId]) slice.project.data.vppExtensions[packageId] = {}
          slice.project.data.vppExtensions[packageId][screenId] = data
        }),
      )
    },

    createPou: (dto) => {
      const existing = getState().project.data.pous.find((p) => p.name === dto.data.name)
      if (existing) return fail('POU already exists')
      if (dto.data.name.toUpperCase() === 'GVL') return fail('POU name "GVL" is reserved for the global namespace')

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
    setPouVariablesText: (name, text, unparsed = false) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (!pou) return
          pou.variablesText = text
          if (unparsed) pou.variablesTextUnparsed = true
          else delete pou.variablesTextUnparsed
        }),
      )
    },
    clearPouVariablesText: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === name)
          if (pou) delete pou.variablesText
        }),
      )
    },
    updatePouName: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          const pou = slice.project.data.pous.find((p) => p.name === oldName)
          if (pou) {
            const folder = getFolderFromPouType(pou.pouType)
            const ext = getExtensionFromLanguage(pou.body.language)
            slice.pendingDeletions.push(`pous/${folder}/${oldName}${ext}`)
            pou.name = newName

            if (pou.body.language === 'ld' || pou.body.language === 'fbd') {
              const bodyValue = pou.body.value as { name?: string } | undefined
              if (bodyValue && typeof bodyValue === 'object') {
                bodyValue.name = newName
              }
            }

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
      regenerateVariablesText(name, getState)
    },

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

      const sourceVariables = scopedVariables(getState().project.data, scope, associatedPou, dto.associatedList) ?? []
      const nameTaken =
        scope === 'global'
          ? (name: string) => elementNameCollision(getState(), name, 'resource-global') !== null
          : undefined
      const validated = createVariableValidation(sourceVariables, data, nameTaken)
      data = { ...data, ...validated }

      if (scope === 'global') {
        const collision = elementNameCollision(getState(), data.name, 'resource-global')
        /* istanbul ignore next -- only when every auto-increment candidate is taken */
        if (collision) return fail(collision, 'Variable already exists')
      }

      let response: ProjectResponse = { ok: true }
      setState(
        produce((slice: ProjectSlice) => {
          const variables = scopedVariables(slice.project.data, scope, associatedPou, dto.associatedList)
          if (!variables) {
            response = fail(scope === 'global-variable-list' ? 'Global variable list not found' : 'POU not found')
            return
          }

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
          if (scope === 'global-variable-list') clearGlobalVariableListText(slice.project.data, dto.associatedList)
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
      regenerateVariablesText(pouName, getState)
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
    updateVariable: ({ scope, associatedPou, associatedList, rowId, variableId, data: updates }) => {
      if (scope === 'local') {
        const reconcile = reconcileVariablesText(associatedPou, getState, setState)
        if (!reconcile.ok) return reconcile
      }

      if (scope === 'global' && updates.name !== undefined) {
        const globals = getState().project.data.configurations.resource.globalVariables
        const current = getVariableBasedOnRowIdOrVariableId(globals, rowId, variableId)
        if (current) {
          const collision = elementNameCollision(getState(), updates.name, 'resource-global', current.variable.name)
          if (collision) return fail(collision, 'Variable already exists')
        }
      }

      let response: ProjectResponse = { ok: true }

      setState(
        produce((slice: ProjectSlice) => {
          const variables = scopedVariables(slice.project.data, scope, associatedPou, associatedList)
          if (!variables) {
            response = fail(scope === 'global-variable-list' ? 'Global variable list not found' : 'POU not found')
            return
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

          if (scope === 'global-variable-list') clearGlobalVariableListText(slice.project.data, associatedList)

          if (updates.debug !== undefined && scope !== 'global-variable-list') {
            const target = variables[found.index]
            if (scope === 'global' || target.class === 'external') {
              syncGlobalDebugFlag(slice, target.name, updates.debug)
            }
          }
        }),
      )
      if (scope === 'local' && response.ok) regenerateVariablesText(associatedPou, getState)
      return response
    },
    getVariable: ({ scope, associatedPou, associatedList, rowId, variableId }) => {
      const variables = scopedVariables(getState().project.data, scope, associatedPou, associatedList)
      if (!variables) return undefined

      const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
      return found?.variable
    },
    deleteVariable: ({ scope, associatedPou, associatedList, rowId, variableId, variableName, force }) => {
      if (scope === 'local') {
        const reconcile = reconcileVariablesText(associatedPou, getState, setState)
        if (!reconcile.ok) return reconcile
      }

      let cascade: { globalName: string; pous: string[] } | null = null
      if (scope === 'global') {
        const state = getState()
        const globalVars = state.project.data.configurations.resource.globalVariables
        const variableToDelete = variableName
          ? globalVars.find((v) => v.name.toLowerCase() === variableName.toLowerCase())
          : getVariableBasedOnRowIdOrVariableId(globalVars, rowId, variableId)?.variable

        if (variableToDelete) {
          const referencingPous = state.project.data.pous
            .filter((pou) =>
              pou.interface?.variables?.some(
                (v) => v.class === 'external' && v.name.toLowerCase() === variableToDelete.name.toLowerCase(),
              ),
            )
            .map((pou) => pou.name)

          if (referencingPous.length > 0) {
            if (!force) {
              return {
                ok: false,
                title: 'Cannot Delete Global Variable',
                message: `The global variable "${variableToDelete.name}" is used as an external variable in the following POUs: ${referencingPous.join(', ')}.`,
                data: { referencingPous },
              }
            }
            cascade = { globalName: variableToDelete.name, pous: referencingPous }
          }
        }
      }

      let response: ProjectResponse = { ok: true }
      setState(
        produce((slice: ProjectSlice) => {
          const variables = scopedVariables(slice.project.data, scope, associatedPou, associatedList)
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
          } else {
            const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
            if (!found) {
              response = fail('Variable not found')
              return
            }
            variables.splice(found.index, 1)
          }

          if (scope === 'global-variable-list') clearGlobalVariableListText(slice.project.data, associatedList)

          if (cascade) {
            const { globalName, pous } = cascade
            for (const pouName of pous) {
              const pouVars = slice.project.data.pous.find((p) => p.name === pouName)?.interface?.variables
              const extIdx =
                pouVars?.findIndex(
                  (v) => v.class === 'external' && v.name.toLowerCase() === globalName.toLowerCase(),
                ) ?? -1
              if (pouVars && extIdx !== -1) pouVars.splice(extIdx, 1)
            }
          }
        }),
      )
      if (scope === 'local' && response.ok) regenerateVariablesText(associatedPou, getState)
      if (response.ok && cascade) {
        for (const pouName of cascade.pous) regenerateVariablesText(pouName, getState)
      }
      return response
    },
    rearrangeVariables: ({ scope, associatedPou, associatedList, rowId, variableId, newIndex }) => {
      setState(
        produce((slice: ProjectSlice) => {
          const variables = scopedVariables(slice.project.data, scope, associatedPou, associatedList)
          if (!variables) return

          const found = getVariableBasedOnRowIdOrVariableId(variables, rowId, variableId)
          if (!found) return
          const [item] = variables.splice(found.index, 1)
          variables.splice(newIndex, 0, item)
          if (scope === 'global-variable-list') clearGlobalVariableListText(slice.project.data, associatedList)
        }),
      )
      if (scope === 'local') regenerateVariablesText(associatedPou, getState)
    },

    renameAlias: (oldAlias, newAlias) => {
      const trimmedOld = oldAlias?.trim() ?? ''
      const trimmedNew = newAlias?.trim() ?? ''
      if (trimmedOld.length === 0) return { renamed: 0 }
      if (trimmedNew.length === 0) return { renamed: 0 }
      if (trimmedOld === trimmedNew) return { renamed: 0 }
      if (trimmedOld.startsWith('%') || trimmedNew.startsWith('%')) return { renamed: 0 }

      let renamed = 0
      const touched = new Set<string>()
      const cascade = (variable: PLCVariable): PLCVariable => {
        if (variable.location !== trimmedOld) return variable
        renamed += 1
        return { ...variable, location: trimmedNew }
      }

      setState(
        produce((slice: ProjectSlice) => {
          for (const pou of slice.project.data.pous) {
            /* istanbul ignore if -- schema guarantees `interface.variables`; defensive */
            if (!pou.interface?.variables) continue
            for (let i = 0; i < pou.interface.variables.length; i++) {
              const before = pou.interface.variables[i]
              const after = cascade(before)
              if (after !== before) touched.add(pou.name)
              pou.interface.variables[i] = after
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

      for (const pouName of touched) {
        regenerateVariablesText(pouName, getState)
      }

      for (const pou of getState().project.data.pous) {
        if (touched.has(pou.name)) continue
        const text = pou.variablesText
        if (text === undefined) continue
        const rewritten = renameAliasInText(text, trimmedOld, trimmedNew)
        if (rewritten !== text) {
          getState().projectActions.setPouVariablesText(pou.name, rewritten, pou.variablesTextUnparsed)
        }
      }

      return { renamed }
    },

    createGlobalVariableList: (name) => {
      const lists = getState().project.data.globalVariableLists ?? []
      if (lists.some((list) => nameMatches(list.name, name))) {
        return fail('Global variable list already exists')
      }

      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.globalVariableLists = [
            ...(slice.project.data.globalVariableLists ?? []),
            { name, variables: [] },
          ]
        }),
      )
      return ok()
    },
    deleteGlobalVariableList: (name) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.globalVariableLists = (slice.project.data.globalVariableLists ?? []).filter(
            (list) => !nameMatches(list.name, name),
          )
        }),
      )
    },
    updateGlobalVariableList: (name, variables) => {
      setState(
        produce((slice: ProjectSlice) => {
          const list = (slice.project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, name))
          if (!list) return
          list.variables = variables
          delete list.text
        }),
      )
    },
    updateGlobalVariableListQualifier: (name, qualifier) => {
      setState(
        produce((slice: ProjectSlice) => {
          const list = (slice.project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, name))
          if (!list) return
          if (qualifier) list.qualifier = qualifier
          else delete list.qualifier
        }),
      )
    },
    updateGlobalVariableListName: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          const list = (slice.project.data.globalVariableLists ?? []).find((l) => nameMatches(l.name, oldName))
          if (!list) return
          list.name = newName
        }),
      )
    },
    duplicateGlobalVariableList: (sourceName, newName) => {
      const lists = getState().project.data.globalVariableLists ?? []
      const source = lists.find((l) => nameMatches(l.name, sourceName))
      if (!source) return fail('Global variable list not found')
      if (lists.some((l) => nameMatches(l.name, newName))) return fail('Global variable list already exists')

      const clone = { ...structuredClone(source), name: newName }

      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.globalVariableLists = [...(slice.project.data.globalVariableLists ?? []), clone]
        }),
      )
      return ok()
    },
    propagateGlobalVariableListRename: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.project.data.pous = slice.project.data.pous.map(
            (pou) => renameGlobalVariableListInPou(pou, oldName, newName) ?? pou,
          )
        }),
      )
    },
    reconcileGlobalVariableListText: (name) => reconcileGlobalVariableListText(name, getState, setState),
    regenerateGlobalVariableListText: (name) => regenerateGlobalVariableListText(name, getState),
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
          slice.pendingDeletions.push(`datatypes/${name}.dt`)
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
    updateDatatypeName: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          const dt = slice.project.data.dataTypes.find((d) => d.name === oldName)
          if (!dt) return
          slice.pendingDeletions.push(`datatypes/${oldName}.dt`)
          dt.name = newName
        }),
      )
    },
    propagateDatatypeRename: (oldName, newName) => {
      setState(
        produce((slice: ProjectSlice) => {
          for (const pou of slice.project.data.pous) {
            for (const variable of pou.interface?.variables ?? []) {
              const nextType = renameDataTypeInVariableType(variable.type, oldName, newName)
              if (nextType) variable.type = nextType
            }
          }
          for (const variable of slice.project.data.configurations.resource.globalVariables) {
            const nextType = renameDataTypeInVariableType(variable.type, oldName, newName)
            if (nextType) variable.type = nextType
          }
          for (const list of slice.project.data.globalVariableLists ?? []) {
            for (const variable of list.variables) {
              const nextType = renameDataTypeInVariableType(variable.type, oldName, newName)
              if (nextType) variable.type = nextType
            }
          }
          slice.project.data.dataTypes = slice.project.data.dataTypes.map(
            (dataType) => renameDataTypeInDataType(dataType, oldName, newName) ?? dataType,
          )
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
      regenerateDatatypeText(name, getState)
    },
    reconcileDatatypeText: (name) => reconcileDatatypeText(name, getState, setState),
    regenerateDatatypeText: (name) => regenerateDatatypeText(name, getState),
    regeneratePouVariablesText: (name) => regenerateVariablesText(name, getState),
    setUnparsedDataTypeFiles: (files) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.unparsedDataTypeFiles = files
        }),
      )
    },
    setDataTypesNeedMigration: (needsMigration) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.dataTypesNeedMigration = needsMigration
        }),
      )
    },
    removeUnparsedDataTypeFile: (relativePath) => {
      setState(
        produce((slice: ProjectSlice) => {
          slice.unparsedDataTypeFiles = slice.unparsedDataTypeFiles.filter((f) => f.relativePath !== relativePath)
        }),
      )
    },

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

    createServer: (dto) => {
      const servers = getState().project.data.servers ?? []
      if (servers.some((s) => s.name === dto.data.name)) return fail('Server already exists')

      const sameProtocol = servers.find((s) => s.protocol === dto.data.protocol)
      if (sameProtocol) {
        return fail(
          `A ${dto.data.protocol} server already exists: "${sameProtocol.name}". Only one reaches the device.`,
        )
      }

      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.servers) slice.project.data.servers = []
          slice.project.data.servers.push(initializeServerProtocolConfig(dto.data, seedTransports(getState())))
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
          if (config.transports !== undefined) server.modbusSlaveConfig.transports = config.transports
          if (config.networkInterface !== undefined) server.modbusSlaveConfig.networkInterface = config.networkInterface
          if (config.port !== undefined) server.modbusSlaveConfig.port = config.port
          if (config.slaveId !== undefined) server.modbusSlaveConfig.slaveId = config.slaveId
          if (config.serialPort !== undefined) server.modbusSlaveConfig.serialPort = config.serialPort
          if (config.baudRate !== undefined) server.modbusSlaveConfig.baudRate = config.baudRate
          if (config.parity !== undefined) server.modbusSlaveConfig.parity = config.parity
          if (config.stopBits !== undefined) server.modbusSlaveConfig.stopBits = config.stopBits
          if (config.dataBits !== undefined) server.modbusSlaveConfig.dataBits = config.dataBits
          if (config.bufferMapping) {
            const base = server.modbusSlaveConfig.bufferMapping ?? {}
            const patch = config.bufferMapping
            server.modbusSlaveConfig.bufferMapping = {
              ...base,
              ...(base.holdingRegisters || patch.holdingRegisters
                ? { holdingRegisters: { ...base.holdingRegisters, ...patch.holdingRegisters } }
                : {}),
              ...(base.coils || patch.coils ? { coils: { ...base.coils, ...patch.coils } } : {}),
              ...(base.discreteInputs || patch.discreteInputs
                ? { discreteInputs: { ...base.discreteInputs, ...patch.discreteInputs } }
                : {}),
              ...(base.inputRegisters || patch.inputRegisters
                ? { inputRegisters: { ...base.inputRegisters, ...patch.inputRegisters } }
                : {}),
            }
          }
        }),
      )
      return ok()
    },
    clearServerBufferCount: (name, group, field) => {
      setState(
        produce((slice: ProjectSlice) => {
          const config = slice.project.data.servers?.find((s) => s.name === name)?.modbusSlaveConfig
          const mapping = config?.bufferMapping
          if (!config || !mapping) return
          if (group === 'holdingRegisters' && mapping.holdingRegisters) {
            if (field === 'qwCount') delete mapping.holdingRegisters.qwCount
            if (field === 'mwCount') delete mapping.holdingRegisters.mwCount
            if (field === 'mdCount') delete mapping.holdingRegisters.mdCount
            if (field === 'mlCount') delete mapping.holdingRegisters.mlCount
            if (Object.keys(mapping.holdingRegisters).length === 0) delete mapping.holdingRegisters
          }
          if (group === 'coils' && mapping.coils) {
            if (field === 'qxBits') delete mapping.coils.qxBits
            if (field === 'mxBits') delete mapping.coils.mxBits
            if (Object.keys(mapping.coils).length === 0) delete mapping.coils
          }
          if (group === 'discreteInputs' && mapping.discreteInputs) {
            if (field === 'ixBits') delete mapping.discreteInputs.ixBits
            if (Object.keys(mapping.discreteInputs).length === 0) delete mapping.discreteInputs
          }
          if (group === 'inputRegisters' && mapping.inputRegisters) {
            if (field === 'iwCount') delete mapping.inputRegisters.iwCount
            if (Object.keys(mapping.inputRegisters).length === 0) delete mapping.inputRegisters
          }
          if (Object.keys(mapping).length === 0) delete config.bufferMapping
        }),
      )
      return ok()
    },

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

    updateOpcUaServerConfig: (name, config) => {
      setState(
        produce((slice: ProjectSlice) => {
          const server = slice.project.data.servers?.find((s) => s.name === name)
          if (!server?.opcuaServerConfig) return
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
    addOpcUaNodes: (name, nodes) => {
      const server = getState().project.data.servers?.find((s) => s.name === name)
      if (!server?.opcuaServerConfig) return fail('OPC-UA server not found')

      setState(
        produce((slice: ProjectSlice) => {
          const target = slice.project.data.servers?.find((s) => s.name === name)
          if (!target?.opcuaServerConfig) return
          const taken = new Set(target.opcuaServerConfig.addressSpace.nodes.map((n) => n.id))
          for (const node of nodes) {
            if (taken.has(node.id)) continue
            taken.add(node.id)
            target.opcuaServerConfig.addressSpace.nodes.push(node)
          }
        }),
      )
      return ok()
    },
    removeOpcUaNodes: (name, nodeIds) => {
      const server = getState().project.data.servers?.find((s) => s.name === name)
      if (!server?.opcuaServerConfig) return fail('OPC-UA server not found')

      setState(
        produce((slice: ProjectSlice) => {
          const target = slice.project.data.servers?.find((s) => s.name === name)
          if (!target?.opcuaServerConfig) return
          const doomed = new Set(nodeIds)
          target.opcuaServerConfig.addressSpace.nodes = target.opcuaServerConfig.addressSpace.nodes.filter(
            (n) => !doomed.has(n.id),
          )
        }),
      )
      return ok()
    },

    createRemoteDevice: (dto) => {
      const devices = getState().project.data.remoteDevices ?? []
      if (devices.some((d) => d.name === dto.data.name)) return fail('Remote device already exists')

      setState(
        produce((slice: ProjectSlice) => {
          if (!slice.project.data.remoteDevices) slice.project.data.remoteDevices = []
          const device = { ...dto.data }
          if (device.protocol === 'modbus-tcp' && !device.modbusTcpConfig) {
            device.modbusTcpConfig = createDefaultRemoteDeviceConfig(resolveMasterProfile(getState()))
          }
          slice.project.data.remoteDevices.push(device)
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
          if (config.transport !== undefined) device.modbusTcpConfig.transport = config.transport
          if (config.host !== undefined) device.modbusTcpConfig.host = config.host
          if (config.port !== undefined) device.modbusTcpConfig.port = config.port
          if (config.reconnect !== undefined) device.modbusTcpConfig.reconnect = config.reconnect
          if (config.serialPort !== undefined) device.modbusTcpConfig.serialPort = config.serialPort
          if (config.baudRate !== undefined) device.modbusTcpConfig.baudRate = config.baudRate
          if (config.parity !== undefined) device.modbusTcpConfig.parity = config.parity
          if (config.stopBits !== undefined) device.modbusTcpConfig.stopBits = config.stopBits
          if (config.dataBits !== undefined) device.modbusTcpConfig.dataBits = config.dataBits
          if (config.slaveId !== undefined) device.modbusTcpConfig.slaveId = config.slaveId
          if (config.timeout !== undefined) device.modbusTcpConfig.timeout = config.timeout
          if (
            config.reconnect === undefined &&
            device.modbusTcpConfig.reconnect === undefined &&
            (device.modbusTcpConfig.transport ?? 'tcp') === 'tcp'
          ) {
            device.modbusTcpConfig.reconnect = true
          }
        }),
      )
      return ok()
    },
    normalizeProjectAliases: () => {
      const live = getState()
      const board = live.deviceDefinitions.configuration.deviceBoard
      const pins = live.deviceDefinitions.pinMapping.pinsByBoard[board] ?? []
      const vppEntries = readVppEntries(live)
      const remoteDevices = live.project.data.remoteDevices ?? []

      const aliases: string[] = [
        ...pins.map((pin) => pin.alias ?? ''),
        ...vppEntries.map((entry) => entry.alias ?? ''),
        ...remoteDevices.flatMap((device) => [
          ...(device.modbusTcpConfig?.ioGroups ?? []).flatMap((group) =>
            (group.ioPoints ?? []).map((point) => point.alias ?? ''),
          ),
          ...(device.ethercatConfig?.devices ?? []).flatMap((slave) => [
            ...(slave.channelMappings ?? []).map((channel) => channel.alias ?? ''),
            ...(slave.modules ?? []).flatMap((module) => module.channelMappings.map((channel) => channel.alias ?? '')),
          ]),
        ]),
      ].filter((alias) => alias.trim() !== '')

      const plan = planAliasNormalization(aliases)
      if (plan.length === 0) return { repairs: [] }

      const queued = new Map<string, string[]>()
      for (const entry of plan) queued.set(entry.from, [...(queued.get(entry.from) ?? []), entry.to])
      const remap = (alias: string | undefined): string | undefined => {
        if (alias === undefined) return alias
        const pending = queued.get(alias)
        if (pending === undefined || pending.length === 0) return alias
        return pending.shift()
      }

      setState(
        produce((slice: ProjectSliceRoot) => {
          for (const pin of slice.deviceDefinitions.pinMapping.pinsByBoard[board] ?? []) {
            pin.alias = remap(pin.alias)
          }
          for (const entry of readVppEntries(slice)) {
            entry.alias = remap(entry.alias)
          }
          for (const device of slice.project.data.remoteDevices ?? []) {
            for (const group of device.modbusTcpConfig?.ioGroups ?? []) {
              for (const point of group.ioPoints ?? []) point.alias = remap(point.alias)
            }
            for (const slave of device.ethercatConfig?.devices ?? []) {
              for (const channel of slave.channelMappings ?? []) channel.alias = remap(channel.alias)
              for (const module of slave.modules ?? []) {
                for (const channel of module.channelMappings) channel.alias = remap(channel.alias)
              }
            }
          }
        }),
      )

      const cascaded = new Set<string>()
      for (const entry of plan) {
        if (cascaded.has(entry.from)) continue
        cascaded.add(entry.from)
        getState().projectActions.renameAlias(entry.from, entry.to)
      }

      return { repairs: plan }
    },
    recalculateIecAddresses: () => {
      const live = getState()
      warnIfTargetUnresolved(live)
      const registry = buildIecRegistry(live)
      const index = indexRegistry(registry)

      const vppEntries = readVppEntries(live)
      if (vppEntries.length > 0) {
        const stored = live.deviceDefinitions.configuration.vendorScreenData?.['io-mapping']
        getState().deviceActions.setVendorScreenData('io-mapping', {
          ...(stored && typeof stored === 'object' ? stored : {}),
          entries: applyVppEntries(vppEntries, index),
        })
      }

      setState(
        produce((slice: ProjectSlice) => {
          applyModbusAddresses(slice.project.data.remoteDevices, index)
          applyEthercatAddresses(slice.project.data.remoteDevices, index)
        }),
      )
      return ok()
    },
    rememberChannelAlias: (memoryKey, alias) => {
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
      const live = getState()
      return resolveProjectAliases(live.project.data, getMemoizedAliasIndex(live))
    },
    getAliasIndex: () => getMemoizedAliasIndex(getState()),
    addIOGroup: (deviceName, group) => {
      const pool = buildModbusProducerPool(getState())

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return

          const pending = new Set<string>()
          const length = clampIOGroupLength(group.functionCode, group.length)
          const errorHandling = resolveIOGroupErrorHandling(group.functionCode, group.errorHandling)
          const ioPoints = generateIOPoints(group.functionCode, length, group.name, pool, pending)
          device.modbusTcpConfig.ioGroups.push({ ...group, length, errorHandling, ioPoints })
        }),
      )
      getState().projectActions.recalculateIecAddresses()
      return ok()
    },
    updateIOGroup: (deviceName, groupId, updates) => {
      const pool = buildModbusProducerPool(getState(), { deviceName, groupId })

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          const group = device.modbusTcpConfig.ioGroups.find((g) => g.id === groupId)
          if (!group) return
          const existingPoints = group.ioPoints ?? []
          Object.assign(group, updates)
          group.length = clampIOGroupLength(group.functionCode, group.length)
          group.errorHandling = resolveIOGroupErrorHandling(group.functionCode, group.errorHandling)
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
      getState().projectActions.recalculateIecAddresses()
      return ok()
    },
    importIOGroups: (deviceName, groups, options) => {
      const replace = options?.replace ?? false
      const live = getState()
      const target = live.project.data.remoteDevices?.find((d) => d.name === deviceName)
      if (!target?.modbusTcpConfig) {
        return { ok: false, title: 'Import failed', message: `Remote device "${deviceName}" was not found.` }
      }

      const names = [...(replace ? [] : target.modbusTcpConfig.ioGroups), ...groups].map((g) => g.name.toLowerCase())
      const duplicate = names.find((name, index) => names.indexOf(name) !== index)
      if (duplicate !== undefined) {
        return {
          ok: false,
          title: 'Import failed',
          message: `More than one IO group would be named "${duplicate}". IO group names must be unique per device.`,
        }
      }

      setState(
        produce((slice: ProjectSlice) => {
          const device = slice.project.data.remoteDevices?.find((d) => d.name === deviceName)
          if (!device?.modbusTcpConfig) return
          if (replace) device.modbusTcpConfig.ioGroups = []

          for (const group of groups) {
            const length = clampIOGroupLength(group.functionCode, group.length)
            const errorHandling = resolveIOGroupErrorHandling(group.functionCode, group.errorHandling)
            const ioPoints = seedIOPoints(group.functionCode, length, group.name)
            device.modbusTcpConfig.ioGroups.push({ ...group, length, errorHandling, ioPoints })
          }
        }),
      )
      getState().projectActions.recalculateIecAddresses()
      return ok({ imported: groups.length })
    },
    updateIOPointAlias: (deviceName, groupId, pointId, alias) => {
      const live = getState()
      const sourceRef = { kind: 'modbus-tcp-remote' as const, ref: `${deviceName}:${pointId}` }
      const registry = buildAliasRegistry(buildModbusProducerPool(live))
      const validation = validateAliasEdit(registry, alias, sourceRef)
      if (!validation.ok) {
        const rejection = describeAliasRejection(validation, alias)
        return { ok: false, title: rejection.title, message: rejection.description }
      }

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
        }),
      )
      if (response.ok) {
        for (const slave of ethercatConfig.devices ?? []) {
          for (const mapping of slave.channelMappings ?? []) {
            const old = prevAliasByChannel.get(`${slave.name}:${mapping.channelId}`)
            if (old && old !== (mapping.alias ?? '')) getState().projectActions.renameAlias(old, mapping.alias ?? '')
          }
        }
        getState().projectActions.recalculateIecAddresses()
      }
      return response
    },
  },
})

export { createProjectSlice }
