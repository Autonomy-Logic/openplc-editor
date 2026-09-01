/**
 * One Modbus-server view over two stores.
 *
 * A Runtime v4 server is a project element: a `PLCServer` in
 * `project.data.servers`, written to `devices/servers/<name>.json`. A baremetal
 * board's Modbus config is board state: sections of `vendorScreenData`, keyed
 * by section id, archived per board in `vendorScreenDataByBoard`.
 *
 * Keeping them in their own stores is deliberate. The persistence key for a VPP
 * section IS the section id, so leaving baremetal config where it is means no
 * project file migrates; every device's `debug` spec `$ref`s
 * `screens.modbus_rtu.*`, so Connect keeps resolving; and the scopes genuinely
 * differ — a Wi-Fi SSID stored project-wide would follow the project onto a
 * board with no radio.
 *
 * What should NOT differ is the screen. This hook is the seam: it reads and
 * writes whichever store the target's profile names, and hands the component a
 * single shape.
 */

import { useCallback, useMemo } from 'react'

import type { ModbusBufferMapping } from '../../middleware/shared/ports/types'
import type { ModbusSegmentCounts, ModbusServerProfile } from '../../middleware/shared/utils/modbus-server-profile'
import { resolveModbusServerProfile } from '../../middleware/shared/utils/modbus-server-profile'
import { useOpenPLCStore } from '../store'
import { DEFAULT_BUFFER_MAPPING } from '../utils/modbus/generate-modbus-slave-config'

/** VPP section ids the screen reads and writes. Stable across the pre- and
 *  post-split screen shapes, which is why the split needed no migration. */
const RTU_SECTION = 'modbus_rtu'
const TCP_SECTION = 'modbus_tcp'
const NETWORK_SECTION = 'network'

/** Field ids within those sections. */
const FIELD_ENABLED = 'enabled'
const FIELD_SLAVE_ID = 'rtu_slave_id'

/** Slave id the firmware falls back to (`modbus_config.h`). */
const DEFAULT_SLAVE_ID = 1

export interface ModbusServerView {
  profile: ModbusServerProfile
  rtu: { enabled: boolean; slaveId: number }
  tcp: { enabled: boolean; port: number; bindAddress: string }
  /** Buffer counts in IEC values. Derived and read-only when the profile says
   *  the firmware fixes them. */
  buffers: ModbusSegmentCounts
  /** Present only for the `plc-server` store — the address-map component and
   *  the save path both still speak the persisted shape. */
  bufferMapping: ModbusBufferMapping
  /** True when the screen has a store to write to at all. */
  available: boolean
}

export interface ModbusServerActions {
  setTransportEnabled: (transport: 'rtu' | 'tcp', enabled: boolean) => void
  setSlaveId: (slaveId: number) => void
  setPort: (port: number) => void
  setBindAddress: (address: string) => void
  setBufferCount: (group: keyof ModbusBufferMapping, field: string, value: number) => void
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function countsFromMapping(mapping: ModbusBufferMapping): ModbusSegmentCounts {
  const d = DEFAULT_BUFFER_MAPPING
  return {
    QW: mapping.holdingRegisters?.qwCount ?? d.holdingRegisters.qwCount,
    MW: mapping.holdingRegisters?.mwCount ?? d.holdingRegisters.mwCount,
    MD: mapping.holdingRegisters?.mdCount ?? d.holdingRegisters.mdCount,
    ML: mapping.holdingRegisters?.mlCount ?? d.holdingRegisters.mlCount,
    QX: mapping.coils?.qxBits ?? d.coils.qxBits,
    MX: mapping.coils?.mxBits ?? d.coils.mxBits,
    IX: mapping.discreteInputs?.ixBits ?? d.discreteInputs.ixBits,
    IW: mapping.inputRegisters?.iwCount ?? d.inputRegisters.iwCount,
  }
}

/** Counts to show when the firmware fixes them and the board declared none. */
const UNKNOWN_COUNTS: ModbusSegmentCounts = { QW: 0, MW: 0, MD: 0, ML: 0, QX: 0, MX: 0, IX: 0, IW: 0 }

/**
 * Read and write the Modbus server config for the current target.
 *
 * `serverName` names the `PLCServer` to edit and is ignored by the
 * vendor-screen store, where the board has exactly one Modbus configuration
 * and no name to disambiguate.
 */
export function useModbusServerConfig(serverName: string): ModbusServerView & { actions: ModbusServerActions } {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const setVendorScreenData = useOpenPLCStore((s) => s.deviceActions.setVendorScreenData)
  const servers = useOpenPLCStore((s) => s.project.data.servers)
  const updateServerConfig = useOpenPLCStore((s) => s.projectActions.updateServerConfig)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )

  const boardInfo = availableBoards.get(deviceBoard)
  const profile = useMemo(() => resolveModbusServerProfile(boardInfo), [boardInfo])

  const server = useMemo(() => servers?.find((s) => s.name === serverName), [servers, serverName])

  /** Read a field out of a vendor-screen section. */
  const readSection = useCallback(
    (sectionId: string): Record<string, unknown> => {
      const raw = vendorScreenData?.[sectionId]
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    },
    [vendorScreenData],
  )

  /**
   * Merge a patch into a vendor-screen section.
   *
   * `setVendorScreenData` replaces the whole section, so every write has to
   * read first — the form layout only persists fields the user touched, and
   * clobbering the section would drop the baud rate the Serial screen set.
   */
  const patchSection = useCallback(
    (sectionId: string, patch: Record<string, unknown>) => {
      setVendorScreenData(sectionId, { ...readSection(sectionId), ...patch })
    },
    [readSection, setVendorScreenData],
  )

  const view = useMemo<ModbusServerView>(() => {
    if (profile.store === 'vendor-screen') {
      const rtu = readSection(RTU_SECTION)
      const tcp = readSection(TCP_SECTION)
      const counts = profile.derivedCounts ?? UNKNOWN_COUNTS
      return {
        profile,
        rtu: {
          enabled: asBoolean(rtu[FIELD_ENABLED]),
          slaveId: asNumber(rtu[FIELD_SLAVE_ID], DEFAULT_SLAVE_ID),
        },
        tcp: {
          enabled: asBoolean(tcp[FIELD_ENABLED]),
          port: profile.fixedPort,
          bindAddress: '',
        },
        buffers: counts,
        bufferMapping: {
          holdingRegisters: { qwCount: counts.QW, mwCount: counts.MW, mdCount: counts.MD, mlCount: counts.ML },
          coils: { qxBits: counts.QX, mxBits: counts.MX },
          discreteInputs: { ixBits: counts.IX },
          inputRegisters: { iwCount: counts.IW },
        },
        available: true,
      }
    }

    const config = server?.modbusSlaveConfig
    const mapping = config?.bufferMapping ?? DEFAULT_BUFFER_MAPPING
    return {
      profile,
      rtu: { enabled: false, slaveId: DEFAULT_SLAVE_ID },
      tcp: {
        enabled: config?.enabled ?? false,
        port: config?.port ?? profile.fixedPort,
        bindAddress: config?.networkInterface || '0.0.0.0',
      },
      buffers: countsFromMapping(mapping),
      bufferMapping: mapping,
      available: profile.store === 'plc-server',
    }
  }, [profile, readSection, server])

  const markDirty = useCallback(() => {
    // The vendor-screen tab tracks its own dirty state by diffing the slice it
    // owns against the snapshot taken on mount, so it needs no nudge here.
    if (profile.store === 'plc-server') handleFileAndWorkspaceSavedState(serverName)
  }, [profile.store, serverName, handleFileAndWorkspaceSavedState])

  const setTransportEnabled = useCallback(
    (transport: 'rtu' | 'tcp', enabled: boolean) => {
      if (profile.store === 'vendor-screen') {
        patchSection(transport === 'rtu' ? RTU_SECTION : TCP_SECTION, { [FIELD_ENABLED]: enabled })
        // Modbus TCP cannot come up without a network, and the Network screen
        // is a separate page the user may never open. Turning the network on
        // with the transport is what the user meant; leaving it off produced a
        // board that compiled MBTCP and never linked.
        if (transport === 'tcp' && enabled && profile.vppScreens.network) {
          patchSection(NETWORK_SECTION, { [FIELD_ENABLED]: true })
        }
        return
      }
      if (transport !== 'tcp') return
      updateServerConfig(serverName, { enabled })
      markDirty()
    },
    [profile, patchSection, serverName, updateServerConfig, markDirty],
  )

  const setSlaveId = useCallback(
    (slaveId: number) => {
      if (profile.store !== 'vendor-screen') return
      patchSection(RTU_SECTION, { [FIELD_SLAVE_ID]: slaveId })
    },
    [profile.store, patchSection],
  )

  const setPort = useCallback(
    (port: number) => {
      if (!profile.configurablePort) return
      updateServerConfig(serverName, { port })
      markDirty()
    },
    [profile.configurablePort, serverName, updateServerConfig, markDirty],
  )

  const setBindAddress = useCallback(
    (address: string) => {
      if (!profile.configurableBindAddress) return
      updateServerConfig(serverName, { networkInterface: address })
      markDirty()
    },
    [profile.configurableBindAddress, serverName, updateServerConfig, markDirty],
  )

  const setBufferCount = useCallback(
    (group: keyof ModbusBufferMapping, field: string, value: number) => {
      if (!profile.configurableBuffers) return
      updateServerConfig(serverName, { bufferMapping: { [group]: { [field]: value } } })
      markDirty()
    },
    [profile.configurableBuffers, serverName, updateServerConfig, markDirty],
  )

  return {
    ...view,
    actions: { setTransportEnabled, setSlaveId, setPort, setBindAddress, setBufferCount },
  }
}
