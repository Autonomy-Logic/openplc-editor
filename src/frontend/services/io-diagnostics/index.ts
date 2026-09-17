/**
 * What the compile pipeline would size this project's I/O image to, without
 * compiling it (DOPE-615).
 *
 * Calls the pipeline's own functions rather than restating their rules, so a
 * snapshot that disagrees with a build is a bug in one of them and not a third
 * opinion. Pure: no store, no IPC, no disk.
 */

import type { ComputeIoImageInput, IoImageOrigin } from '../../../backend/shared/compile/steps/compute-io-image'
import {
  computeIoImage,
  describeDuplicateOutput,
  describeUnbackedLocation,
  describeUnsupportedArea,
  IMAGE_AREAS_BAREMETAL,
  IMAGE_AREAS_RUNTIME_V4,
  locatedVariables,
  vppEntries,
} from '../../../backend/shared/compile/steps/compute-io-image'
import { generateProcessImageDefines } from '../../../backend/shared/compile/steps/generate-defines'
import { generateImageConf } from '../../../backend/shared/compile/steps/generate-image-conf'
import type { DevicePin, PLCProjectData as PortProjectData } from '../../../middleware/shared/ports/types'
import type { ConflictReport, SourceKind } from '../../../middleware/shared/utils/iec-address'
import { activeKindsFor } from '../../../middleware/shared/utils/iec-address/registry'
import type { ImageUnit } from '../../../middleware/shared/utils/io-image/tables'
import { IMAGE_TABLES } from '../../../middleware/shared/utils/io-image/tables'
import type {
  AddressProducerCapabilities,
  BoardInfoLike,
  RuntimeClassification,
  ServerCapabilities,
} from '../../../middleware/shared/utils/target-capabilities'
import {
  classifyBoardRuntime,
  resolveAddressProducerCapabilities,
  resolveTargetCapabilities,
} from '../../../middleware/shared/utils/target-capabilities'
import type { IoDiagnosticsClaim } from './claims'
import { collectProducerClaims, prefixForAddress } from './claims'

/** The four producers the registry knows, in the order the pool builds them. */
const PRODUCER_KINDS: readonly SourceKind[] = ['pin-mapping', 'vpp-io', 'modbus-tcp-remote', 'ethercat']

/** The two protocols the sizer dispatches, of the four the editor accepts. */
const SIZING_PROTOCOLS: ReadonlySet<string> = new Set(['modbus-tcp', 's7comm'])

export type { IoDiagnosticsClaim } from './claims'

export type RuntimeKind = 'runtime-v4' | 'runtime-v3' | 'simulator' | 'arduino-cli'

export interface IoDiagnosticsInput {
  /** The board name as the device dropdown holds it. */
  board: string
  /** `undefined` when the board name does not resolve, which the snapshot
   *  reports rather than hides. */
  boardInfo: BoardInfoLike | undefined
  /** Compile-ready project data — `getCompileReadyProjectData()`, with the
   *  aliases already resolved to literal `%…` addresses. */
  projectData: PortProjectData
  devicePinMapping: DevicePin[]
  vendorScreenData?: Record<string, unknown>
}

export interface IoDiagnosticsTarget {
  board: string
  /** False when the capabilities below are the fallback, not a declared answer. */
  resolved: boolean
  kind: RuntimeKind
  /** False for runtime v3 and the simulator, where the pipeline skips the sizer
   *  — the areas below are then what the project asks for, not what ships. */
  sizesTheImage: boolean
  /** Permissive resolver, as the pipeline and the store's recalculation use. */
  producerCapabilities: AddressProducerCapabilities
  /** Strict resolver, as the pipeline uses for servers. */
  serverCapabilities: ServerCapabilities
  activeProducers: SourceKind[]
  inactiveProducers: SourceKind[]
}

export interface IoDiagnosticsArea {
  /** The `image.conf` key. */
  table: string
  prefix: string
  unit: ImageUnit
  /** Slots, in the address's own unit. Zero when nothing reaches this area. */
  size: number
  /** Which contributor put that number there, or `null` when nothing did. */
  origin: IoImageOrigin | null
  /** The bare-metal macro, or `null` for an area bare metal has no buffer for. */
  macro: string | null
  /** True when the target's runtime declares a table for this area at all. */
  present: boolean
}

export interface IoDiagnosticsServer {
  name: string
  protocol: string
  /** The screen's switch. Read by the Modbus emitter, not by the sizer. */
  enabled: boolean
  /** The target runs this protocol at all. */
  runs: boolean
  /** False for OPC UA and EtherNet/IP, which contribute nothing silently. */
  dispatched: boolean
  /** The server the sizer read: first of its protocol carrying a config. */
  sizes: boolean
}

export interface IoDiagnosticsLocated {
  scope: string
  name: string
  /** As stored: a literal `%…` here, aliases already resolved by the caller. */
  location: string
  prefix: string | null
  /** Consecutive slots the declaration claims — more than one for an array. */
  slots: number
  /** `null` when the sizer raised nothing against this declaration. */
  issue: 'unbacked' | 'unsupported' | 'duplicate-output' | null
}

export interface IoDiagnostics {
  target: IoDiagnosticsTarget
  areas: IoDiagnosticsArea[]
  claims: IoDiagnosticsClaim[]
  conflicts: readonly ConflictReport[]
  servers: IoDiagnosticsServer[]
  located: IoDiagnosticsLocated[]
  /** The compile gate's own messages, verbatim — what a build would print. */
  issues: { unbacked: string[]; unsupported: string[]; duplicateOutputs: string[] }
  /** The two files the sizes become, as the emitters write them. */
  artifacts: { imageConf: string; processImageDefines: string }
}

function runtimeKind(runtime: RuntimeClassification): RuntimeKind {
  if (runtime.isSimulator) return 'simulator'
  if (runtime.isRuntimeV3) return 'runtime-v3'
  if (runtime.isRuntimeV4) return 'runtime-v4'
  return 'arduino-cli'
}

/**
 * The store's project data in the shape the sizer reads.
 *
 * The sizer takes the zod-inferred schema shape and the store holds the flat
 * port shape; the two are not structurally assignable, and the compile path
 * casts across the same gap on its way through IPC
 * (`editor-compiler-platform-port.ts`). Zod-validating here instead would be
 * STRICTER than the pipeline — a partial `bufferMapping` a build accepts would
 * be refused — so this mirrors the cast rather than inventing a second answer.
 *
 * Four fields are all the sizer reads: `pous[].data.{name,variables}`,
 * `configuration.resource.globalVariables`, `servers` and `remoteDevices`.
 */
export function toSizerProjectData(data: PortProjectData): ComputeIoImageInput['projectData'] {
  const projected = {
    pous: data.pous.map((pou) => ({
      type: pou.pouType,
      data: { name: pou.name, variables: pou.interface?.variables ?? [] },
    })),
    configuration: data.configurations,
    servers: data.servers,
    remoteDevices: data.remoteDevices,
    dataTypes: [],
    libraries: [],
  }
  return projected as unknown as ComputeIoImageInput['projectData']
}

export function buildIoDiagnostics(input: IoDiagnosticsInput): IoDiagnostics {
  const { boardInfo } = input
  const projectData = toSizerProjectData(input.projectData)
  const runtime = classifyBoardRuntime(input.board, boardInfo?.compiler)

  // Two resolvers, as the pipeline uses them: permissive for producers so an
  // unresolved board keeps its addresses, strict for servers.
  const producerCapabilities = resolveAddressProducerCapabilities(boardInfo)
  const serverCapabilities = resolveTargetCapabilities(boardInfo)
  const areas = runtime.isRuntimeV4 ? IMAGE_AREAS_RUNTIME_V4 : IMAGE_AREAS_BAREMETAL

  const image = computeIoImage({
    projectData,
    devicePinMapping: input.devicePinMapping,
    ...(input.vendorScreenData ? { vendorScreenData: input.vendorScreenData } : {}),
    capabilities: producerCapabilities,
    serverCapabilities,
    areas,
  })

  const { claims, conflicts } = collectProducerClaims({
    capabilities: producerCapabilities,
    pins: { pins: input.devicePinMapping },
    vendorIoMapping: vppEntries(input.vendorScreenData),
    remoteDevices: projectData.remoteDevices,
  })

  const active = activeKindsFor(producerCapabilities)

  return {
    target: {
      board: input.board,
      resolved: boardInfo !== undefined,
      kind: runtimeKind(runtime),
      sizesTheImage: !runtime.isRuntimeV3 && !runtime.isSimulator,
      producerCapabilities,
      serverCapabilities,
      activeProducers: PRODUCER_KINDS.filter((kind) => active.has(kind)),
      inactiveProducers: PRODUCER_KINDS.filter((kind) => !active.has(kind)),
    },
    areas: IMAGE_TABLES.map((table) => ({
      table: table.key,
      prefix: table.prefix,
      unit: table.unit,
      size: image.sizes[table.prefix] ?? 0,
      origin: image.origins[table.prefix] ?? null,
      macro: table.macro ?? null,
      present: areas.has(table.prefix),
    })),
    claims,
    conflicts,
    servers: describeServers(projectData.servers, serverCapabilities),
    located: describeLocated(projectData, image),
    issues: {
      unbacked: image.unbacked.map(describeUnbackedLocation),
      unsupported: image.unsupported.map((issue) => describeUnsupportedArea(issue, input.board)),
      duplicateOutputs: image.duplicateOutputs.map(describeDuplicateOutput),
    },
    artifacts: {
      imageConf: generateImageConf(image.sizes),
      processImageDefines: generateProcessImageDefines(image.sizes),
    },
  }
}

/** One row per server. The three conditions stay separate because a project
 *  where they disagree is the normal case. */
function describeServers(
  servers: ComputeIoImageInput['projectData']['servers'],
  serverCapabilities: ServerCapabilities,
): IoDiagnosticsServer[] {
  const list = servers ?? []
  // Mirrors `serverExposure`: first of each protocol carrying a config.
  const sizing = new Set<unknown>()
  const modbus = serverCapabilities.modbusTcpServer
    ? list.find((server) => server.protocol === 'modbus-tcp' && server.modbusSlaveConfig)
    : undefined
  const s7comm = serverCapabilities.s7Server
    ? list.find((server) => server.protocol === 's7comm' && server.s7commSlaveConfig)
    : undefined
  if (modbus) sizing.add(modbus)
  if (s7comm) sizing.add(s7comm)

  return list.map((server) => ({
    name: server.name,
    protocol: server.protocol,
    enabled: server.modbusSlaveConfig?.enabled ?? server.s7commSlaveConfig?.server.enabled ?? false,
    runs: runsProtocol(server.protocol, serverCapabilities),
    dispatched: SIZING_PROTOCOLS.has(server.protocol),
    sizes: sizing.has(server),
  }))
}

function runsProtocol(protocol: string, capabilities: ServerCapabilities): boolean {
  if (protocol === 'modbus-tcp') return capabilities.modbusTcpServer
  if (protocol === 's7comm') return capabilities.s7Server
  if (protocol === 'opcua') return capabilities.opcuaServer
  return false
}

/** Every located declaration against the sizer's verdict on it. Uses the
 *  sizer's own walk so the set of places a location may live cannot drift. */
function describeLocated(
  projectData: ComputeIoImageInput['projectData'],
  image: ReturnType<typeof computeIoImage>,
): IoDiagnosticsLocated[] {
  const key = (scope: string, name: string) => `${scope} ${name}`
  const issues = new Map<string, IoDiagnosticsLocated['issue']>()
  for (const issue of image.unsupported) issues.set(key(issue.scope, issue.variableName), 'unsupported')
  for (const issue of image.duplicateOutputs) {
    // Both sides: flagging only the first reads as if the second were fine.
    issues.set(key(issue.first.scope, issue.first.variableName), 'duplicate-output')
    issues.set(key(issue.second.scope, issue.second.variableName), 'duplicate-output')
  }
  // Last, because that is the one the build refuses on first.
  for (const issue of image.unbacked) issues.set(key(issue.scope, issue.variableName), 'unbacked')

  return [...locatedVariables(projectData)].map((variable) => ({
    scope: variable.scope,
    name: variable.name,
    location: variable.location,
    prefix: prefixForAddress(variable.location),
    slots: variable.slotCount,
    issue: issues.get(key(variable.scope, variable.name)) ?? null,
  }))
}
