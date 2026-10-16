/**
 * One Modbus-server view over one store.
 *
 * Every target's Modbus server is a `PLCServer` in `project.data.servers`,
 * written to `devices/servers/<name>.json` -- baremetal included, since 4.3.0.
 * Protocol configuration is the editor's, so there is no second store and no
 * fork at each call site: what differs between a microcontroller and a Runtime
 * v4 target is which fields the target lets the user set, and saying that is
 * the profile's job.
 *
 * The board's VPP screens still own most of the physical transport layer -- the
 * default UART's speed, the RS-485 pin, Wi-Fi and Ethernet -- and this hook does
 * not write them. It links out to them instead, and READS one of them: the
 * default port's baud rate, so the screen can show what the build will emit
 * rather than a second opinion about it. Reading a value to display it is not
 * owning it.
 *
 * The speed of a SECONDARY UART is the server's, because the editor is not on
 * that line and nothing else claims it.
 */

import { useCallback, useMemo } from 'react'

import type { ModbusBufferMapping } from '../../middleware/shared/ports/types'
import type {
  ModbusSegment,
  ModbusSegmentCounts,
  ModbusServerProfile,
  ModbusServerTransport,
} from '../../middleware/shared/utils/modbus-server-profile'
import {
  isDefaultPort,
  readSerialBaudState,
  resolveModbusServerProfile,
  resolveRtuPort,
  resolveServerBaud,
  resolveServerSlaveId,
} from '../../middleware/shared/utils/modbus-server-profile'
import type { IoDiagnosticsArea } from '../services/io-diagnostics'
import { useOpenPLCStore } from '../store'
import { useIoDiagnostics } from './use-io-diagnostics'

export interface ModbusServerView {
  profile: ModbusServerProfile
  /** Transports this server answers on, filtered to what the board offers. A
   *  project carried over from a two-UART board can hold `rtu` on a board with
   *  none, and that stale value must not present itself as served. */
  transports: ModbusServerTransport[]
  /** True while the server answers on anything at all. */
  enabled: boolean
  slaveId: number
  serialPort: string
  /** Speed of the UART this server answers on, as a string so it matches the
   *  option list and the emitted define. The package's value when that UART is
   *  the default one, the server's otherwise. */
  baudRate: string
  /** False while the speed is the package's to state -- the default UART, which
   *  is the editor's own line. */
  baudRateEditable: boolean
  port: number
  bindAddress: string
  /** Buffer counts in IEC values. Derived and read-only when the target's
   *  firmware fixes them. */
  buffers: ModbusSegmentCounts
  /** Which segments carry a count the USER pinned, as opposed to one this view
   *  filled in for display.
   *
   * The distinction is the whole point and it was invisible before: the screen
   * showed DEFAULT_BUFFER_MAPPING's 1024 for a server that had persisted
   * nothing, so a number the project did not contain looked exactly like one
   * the user had typed. `compute-io-image` treats an absent count as "expose
   * whatever the image turns out to be" and only an explicitly persisted one
   * as a request, so the screen was promising an exposure the build would not
   * make. Segments missing from this set render their number as a placeholder
   * -- visibly not a value -- rather than as content. */
  pinnedSegments: ReadonlySet<ModbusSegment>
  /** The address-map component and the save path both speak the persisted
   *  shape. */
  bufferMapping: ModbusBufferMapping
  /** True when there is a server to edit on a target that can serve one. */
  available: boolean
}

export interface ModbusServerActions {
  /** The master switch. A server that is off keeps every setting and serves
   *  nothing, which is what the user wants far more often than deleting it. */
  setEnabled: (enabled: boolean) => void
  /** Re-point the server at a different set of transports. Never empty: a
   *  server has to answer on something, and "answers on nothing" is what the
   *  switch above is for. */
  setTransports: (transports: readonly ModbusServerTransport[]) => void
  setSlaveId: (slaveId: number) => void
  setSerialPort: (serialPort: string) => void
  /** Only meaningful on a UART of its own; on the default one the package
   *  states the speed and this is refused rather than silently ignored. */
  setBaudRate: (baudRate: number) => void
  setPort: (port: number) => void
  setBindAddress: (address: string) => void
  setBufferCount: (group: keyof ModbusBufferMapping, field: string, value: number) => void
  /** Unpin a segment: the count stops being a request and the field goes back
   *  to following the image. Without it a number, once typed, could only be
   *  replaced by another number. */
  clearBufferCount: (group: keyof ModbusBufferMapping, field: string) => void
}

/** The segments whose count the project actually stores.
 *
 * Read off the persisted mapping and nothing else: a segment is pinned when
 * its field is present, absent when it is not. `undefined` everywhere is the
 * shape a server has before anyone touches the panel. */
function pinnedFrom(mapping: ModbusBufferMapping | undefined): ReadonlySet<ModbusSegment> {
  const pinned = new Set<ModbusSegment>()
  if (!mapping) return pinned
  if (mapping.holdingRegisters?.qwCount !== undefined) pinned.add('QW')
  if (mapping.holdingRegisters?.mwCount !== undefined) pinned.add('MW')
  if (mapping.holdingRegisters?.mdCount !== undefined) pinned.add('MD')
  if (mapping.holdingRegisters?.mlCount !== undefined) pinned.add('ML')
  if (mapping.coils?.qxBits !== undefined) pinned.add('QX')
  if (mapping.coils?.mxBits !== undefined) pinned.add('MX')
  if (mapping.discreteInputs?.ixBits !== undefined) pinned.add('IX')
  if (mapping.inputRegisters?.iwCount !== undefined) pinned.add('IW')
  return pinned
}

/** What the project sizes each segment to, per the sizer the build runs.
 *
 * An absent prefix is zero and zero is a real size, exactly as `computeIoImage`
 * documents it -- a project with no `%QX` has no reason to carry coils. */
function countsFromImage(areas: readonly IoDiagnosticsArea[]): ModbusSegmentCounts {
  const sized = new Map(areas.map((area) => [area.prefix, area.size]))
  const at = (prefix: string) => sized.get(prefix) ?? 0
  return {
    QW: at('%QW'),
    MW: at('%MW'),
    MD: at('%MD'),
    ML: at('%ML'),
    QX: at('%QX'),
    MX: at('%MX'),
    IX: at('%IX'),
    IW: at('%IW'),
  }
}

/** Resolve each segment the way the emitter does: a pinned count is the
 *  request, an absent one follows the image.
 *
 * The fallback used to be DEFAULT_BUFFER_MAPPING -- 1024 registers and 8192
 * bits, the fixed image this work removes. The screen showed those as the
 * greyed number while the build sized from the project, so the one figure the
 * panel offered as "what you get" was the one thing it would not be. */
function countsFromMapping(mapping: ModbusBufferMapping, image: ModbusSegmentCounts): ModbusSegmentCounts {
  return {
    QW: mapping.holdingRegisters?.qwCount ?? image.QW,
    MW: mapping.holdingRegisters?.mwCount ?? image.MW,
    MD: mapping.holdingRegisters?.mdCount ?? image.MD,
    ML: mapping.holdingRegisters?.mlCount ?? image.ML,
    QX: mapping.coils?.qxBits ?? image.QX,
    MX: mapping.coils?.mxBits ?? image.MX,
    IX: mapping.discreteInputs?.ixBits ?? image.IX,
    IW: mapping.inputRegisters?.iwCount ?? image.IW,
  }
}

function mappingFromCounts(counts: ModbusSegmentCounts): ModbusBufferMapping {
  return {
    holdingRegisters: { qwCount: counts.QW, mwCount: counts.MW, mdCount: counts.MD, mlCount: counts.ML },
    coils: { qxBits: counts.QX, mxBits: counts.MX },
    discreteInputs: { ixBits: counts.IX },
    inputRegisters: { iwCount: counts.IW },
  }
}

/** Counts to show when the firmware fixes them and the board declared none. */
const UNKNOWN_COUNTS: ModbusSegmentCounts = { QW: 0, MW: 0, MD: 0, ML: 0, QX: 0, MX: 0, IX: 0, IW: 0 }

/** Read and write the Modbus server config for `serverName`. */
export function useModbusServerConfig(serverName: string): ModbusServerView & { actions: ModbusServerActions } {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const servers = useOpenPLCStore((s) => s.project.data.servers)
  const updateServerConfig = useOpenPLCStore((s) => s.projectActions.updateServerConfig)
  const clearServerBufferCount = useOpenPLCStore((s) => s.projectActions.clearServerBufferCount)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )

  const boardInfo = availableBoards.get(deviceBoard)
  const profile = useMemo(() => resolveModbusServerProfile(boardInfo), [boardInfo])
  const server = useMemo(() => servers?.find((entry) => entry.name === serverName), [servers, serverName])
  // The same snapshot the diagnostics panel renders, from the same inputs a
  // compile reads, so the screen and the build cannot show different numbers.
  const diagnostics = useIoDiagnostics()

  const view = useMemo<ModbusServerView>(() => {
    const config = server?.modbusSlaveConfig
    // Absent `transports` is a project saved before baremetal had a server, and
    // Runtime v4 has always served TCP and nothing else.
    const stored = config?.transports ?? ['tcp']
    const transports = profile.transports.filter((transport) => stored.includes(transport))

    // A target whose firmware fixes the buffer sizes reports them through the
    // profile; only a target that lets the user size them reads the server.
    const counts = profile.configurableBuffers
      ? countsFromMapping(config?.bufferMapping ?? {}, countsFromImage(diagnostics.areas))
      : (profile.derivedCounts ?? UNKNOWN_COUNTS)

    // Empty means "wherever the board defaults to", which is the default UART.
    const serialPort = config?.serialPort ?? ''
    // Resolved the way the emitter resolves it, from the same function. Deriving
    // it here independently is how the screen ends up showing a read-only baud
    // for the default port while the build emits MBSERIAL_ON_SECONDARY for
    // another one -- the divergence this whole module exists to prevent.
    const baudState = readSerialBaudState(vendorScreenData)
    const onDefaultPort = isDefaultPort(
      resolveRtuPort(config?.serialPort, profile.defaultSerial),
      profile.defaultSerial,
    )

    return {
      profile,
      transports,
      enabled: config?.enabled ?? false,
      slaveId: resolveServerSlaveId(config?.slaveId),
      serialPort,
      baudRate: resolveServerBaud({
        onDefaultPort,
        serverBaud: config?.baudRate,
        state: baudState,
      }),
      baudRateEditable: !onDefaultPort,
      port: profile.configurablePort ? (config?.port ?? profile.fixedPort) : profile.fixedPort,
      bindAddress: config?.networkInterface || '0.0.0.0',
      buffers: counts,
      pinnedSegments: pinnedFrom(config?.bufferMapping),
      // RESOLVED, not persisted: the address map answers which Modbus address
      // each segment lands on, and a segment following the image lands
      // somewhere just as definite as a pinned one.
      bufferMapping: mappingFromCounts(counts),
      available: !!server && profile.transports.length > 0,
    }
  }, [profile, server, vendorScreenData, diagnostics])

  const commit = useCallback(
    (patch: Parameters<typeof updateServerConfig>[1]) => {
      updateServerConfig(serverName, patch)
      handleFileAndWorkspaceSavedState(serverName)
    },
    [serverName, updateServerConfig, handleFileAndWorkspaceSavedState],
  )

  const setEnabled = useCallback((enabled: boolean) => commit({ enabled }), [commit])

  const setTransports = useCallback(
    (transports: readonly ModbusServerTransport[]) => {
      if (transports.length === 0) return
      commit({ transports: [...transports] })
    },
    [commit],
  )

  const setSlaveId = useCallback((slaveId: number) => commit({ slaveId }), [commit])
  const setSerialPort = useCallback((serialPort: string) => commit({ serialPort }), [commit])

  const setBaudRate = useCallback(
    (baudRate: number) => {
      // On the default UART the speed is the editor's line and the package's to
      // state. Accepting a write here would store a value the build ignores.
      if (!view.baudRateEditable) return
      commit({ baudRate })
    },
    [view.baudRateEditable, commit],
  )

  const setBindAddress = useCallback(
    (networkInterface: string) => {
      if (!profile.configurableBindAddress) return
      commit({ networkInterface })
    },
    [profile.configurableBindAddress, commit],
  )

  const setPort = useCallback(
    (port: number) => {
      if (!profile.configurablePort) return
      commit({ port })
    },
    [profile.configurablePort, commit],
  )

  const setBufferCount = useCallback(
    (group: keyof ModbusBufferMapping, field: string, value: number) => {
      if (!profile.configurableBuffers) return
      commit({ bufferMapping: { [group]: { [field]: value } } })
    },
    [profile.configurableBuffers, commit],
  )

  const clearBufferCount = useCallback(
    (group: keyof ModbusBufferMapping, field: string) => {
      if (!profile.configurableBuffers) return
      clearServerBufferCount(serverName, group, field)
      handleFileAndWorkspaceSavedState(serverName)
    },
    [profile.configurableBuffers, clearServerBufferCount, serverName, handleFileAndWorkspaceSavedState],
  )

  return {
    ...view,
    actions: {
      setEnabled,
      setTransports,
      setSlaveId,
      setSerialPort,
      setBaudRate,
      setPort,
      setBindAddress,
      setBufferCount,
      clearBufferCount,
    },
  }
}
