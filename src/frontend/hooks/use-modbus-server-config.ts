/**
 * One Modbus-server view over one store.
 *
 * Every target's Modbus server is a `PLCServer` in `project.data.servers`,
 * written to `devices/servers/<name>.json` -- baremetal included, since 4.4.0.
 * Protocol configuration is the editor's, so there is no second store and no
 * fork at each call site: what differs between a microcontroller and a Runtime
 * v4 target is which fields the target lets the user set, and saying that is
 * the profile's job.
 *
 * The board's VPP screens still own the physical transport layer -- the UART,
 * its speed, the RS-485 pin, Wi-Fi and Ethernet -- and this hook does not touch
 * them. It links out to them instead.
 */

import { useCallback, useMemo } from 'react'

import type { ModbusBufferMapping } from '../../middleware/shared/ports/types'
import type {
  ModbusSegmentCounts,
  ModbusServerProfile,
  ModbusServerTransport,
} from '../../middleware/shared/utils/modbus-server-profile'
import { resolveModbusServerProfile } from '../../middleware/shared/utils/modbus-server-profile'
import { useOpenPLCStore } from '../store'
import { DEFAULT_BUFFER_MAPPING } from '../utils/modbus/generate-modbus-slave-config'

/** Slave id the firmware falls back to (`modbus_config.h`). */
const DEFAULT_SLAVE_ID = 1

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
  port: number
  bindAddress: string
  /** Buffer counts in IEC values. Derived and read-only when the target's
   *  firmware fixes them. */
  buffers: ModbusSegmentCounts
  /** The address-map component and the save path both speak the persisted
   *  shape. */
  bufferMapping: ModbusBufferMapping
  /** True when there is a server to edit on a target that can serve one. */
  available: boolean
}

export interface ModbusServerActions {
  /** Re-point the server at a different set of transports. Never empty: a
   *  server that answers on nothing does not exist, and deleting one is the
   *  explorer's job rather than a state the editor can be left in. */
  setTransports: (transports: readonly ModbusServerTransport[]) => void
  setSlaveId: (slaveId: number) => void
  setSerialPort: (serialPort: string) => void
  setPort: (port: number) => void
  setBindAddress: (address: string) => void
  setBufferCount: (group: keyof ModbusBufferMapping, field: string, value: number) => void
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
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const servers = useOpenPLCStore((s) => s.project.data.servers)
  const updateServerConfig = useOpenPLCStore((s) => s.projectActions.updateServerConfig)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )

  const boardInfo = availableBoards.get(deviceBoard)
  const profile = useMemo(() => resolveModbusServerProfile(boardInfo), [boardInfo])
  const server = useMemo(() => servers?.find((entry) => entry.name === serverName), [servers, serverName])

  const view = useMemo<ModbusServerView>(() => {
    const config = server?.modbusSlaveConfig
    // Absent `transports` is a project saved before baremetal had a server, and
    // Runtime v4 has always served TCP and nothing else.
    const stored = config?.transports ?? ['tcp']
    const transports = profile.transports.filter((transport) => stored.includes(transport))

    // A target whose firmware fixes the buffer sizes reports them through the
    // profile; only a target that lets the user size them reads the server.
    const counts = profile.configurableBuffers
      ? countsFromMapping(config?.bufferMapping ?? DEFAULT_BUFFER_MAPPING)
      : (profile.derivedCounts ?? UNKNOWN_COUNTS)

    return {
      profile,
      transports,
      enabled: (config?.enabled ?? false) && transports.length > 0,
      slaveId: config?.slaveId ?? DEFAULT_SLAVE_ID,
      serialPort: config?.serialPort ?? '',
      port: profile.configurablePort ? (config?.port ?? profile.fixedPort) : profile.fixedPort,
      bindAddress: config?.networkInterface || '0.0.0.0',
      buffers: counts,
      bufferMapping: profile.configurableBuffers
        ? (config?.bufferMapping ?? DEFAULT_BUFFER_MAPPING)
        : mappingFromCounts(counts),
      available: !!server && profile.transports.length > 0,
    }
  }, [profile, server])

  const commit = useCallback(
    (patch: Parameters<typeof updateServerConfig>[1]) => {
      updateServerConfig(serverName, patch)
      handleFileAndWorkspaceSavedState(serverName)
    },
    [serverName, updateServerConfig, handleFileAndWorkspaceSavedState],
  )

  const setTransports = useCallback(
    (transports: readonly ModbusServerTransport[]) => {
      if (transports.length === 0) return
      commit({ transports: [...transports], enabled: true })
    },
    [commit],
  )

  const setSlaveId = useCallback((slaveId: number) => commit({ slaveId }), [commit])
  const setSerialPort = useCallback((serialPort: string) => commit({ serialPort }), [commit])

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

  return {
    ...view,
    actions: { setTransports, setSlaveId, setSerialPort, setPort, setBindAddress, setBufferCount },
  }
}
