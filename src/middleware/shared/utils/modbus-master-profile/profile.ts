import type { BoardInfo } from '../../ports/types'
import { BOARD_NETWORK_SCREEN, BOARD_SERIAL_SCREEN, findBoardScreen } from '../board-screens'
import type { TargetCapabilities } from '../target-capabilities'

export type ModbusMasterTransport = 'tcp' | 'rtu'

/** Where the RTU serial port list comes from: the board's UARTs, or the runtime host at edit time. */
export type ModbusMasterRtuPorts = { source: 'board'; ports: string[] } | { source: 'runtime' }

export interface ModbusMasterProfile {
  /** Transports a remote device may use on this target, TCP first. Empty when the target runs no master. */
  transports: ModbusMasterTransport[]
  rtuPorts: ModbusMasterRtuPorts
  /** What the TCP host field accepts on this target. */
  hostKind: 'ipv4-only' | 'ipv4-or-hostname'
  /** Sockets the board can hold open, or `null` where nothing declares a count. */
  socketBudget: number | null
  /** The target actually polls the devices; the Simulator shows the screen but runs none. */
  runsDevices: boolean
  /** The board package's serial and network screen names; empty off baremetal. */
  vppScreens: { serial?: string; network?: string }
  /** The screen links to the board's settings pages; baremetal only. */
  showBoardLinks: boolean
}

/** A board as the profile takes it; it reads `compiler`, `serialPorts`, `defaultSerial` and the VPP screens. */
export type ModbusMasterBoardInfoLike = Partial<BoardInfo>

/** UART the debugger sits on when a package declares no `defaultSerial`. */
const FALLBACK_DEFAULT_SERIAL = 'Serial'

/** The board's UARTs without the debugger's, in manifest order. */
function spareUarts(board: ModbusMasterBoardInfoLike): string[] {
  const debuggerPort = board.defaultSerial ?? FALLBACK_DEFAULT_SERIAL
  return (board.serialPorts ?? []).filter((port) => port !== debuggerPort)
}

/** Profile of a baremetal board: TCP when the manifest raises it, RTU on a spare UART. */
function resolveBaremetalProfile(board: ModbusMasterBoardInfoLike, caps: TargetCapabilities): ModbusMasterProfile {
  const ports = spareUarts(board)
  const transports: ModbusMasterTransport[] = []
  if (caps.modbusTcpMaster) transports.push('tcp')
  if (caps.modbusRtuMaster && ports.length > 0) transports.push('rtu')
  const screens = board.vpp?.screens

  return {
    transports,
    rtuPorts: { source: 'board', ports },
    hostKind: 'ipv4-only',
    socketBudget: caps.networkSockets,
    runsDevices: true,
    vppScreens: {
      serial: findBoardScreen(screens, BOARD_SERIAL_SCREEN),
      network: findBoardScreen(screens, BOARD_NETWORK_SCREEN),
    },
    showBoardLinks: true,
  }
}

/** Resolve the Modbus master profile of a board from its info and its resolved capabilities. */
export function resolveModbusMasterProfile(
  board: ModbusMasterBoardInfoLike | undefined,
  caps: TargetCapabilities,
): ModbusMasterProfile {
  if (board?.compiler === 'arduino-cli' && !caps.isInProcessSimulator) {
    return resolveBaremetalProfile(board, caps)
  }

  const transports: ModbusMasterTransport[] = []
  if (caps.modbusTcpMaster) transports.push('tcp')
  if (caps.modbusRtuMaster) transports.push('rtu')

  return {
    transports,
    rtuPorts: { source: 'runtime' },
    hostKind: 'ipv4-or-hostname',
    socketBudget: null,
    runsDevices: transports.length > 0 && !caps.isInProcessSimulator,
    vppScreens: {},
    showBoardLinks: false,
  }
}

/** True when the target offers a Modbus remote device at all. */
export function canHostModbusMaster(profile: ModbusMasterProfile): boolean {
  return profile.transports.length > 0
}
