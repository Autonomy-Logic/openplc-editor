export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
  // 0x46-0x48 are reserved for the planned debug subscription/streaming
  // codes, so run/stop control starts at 0x49.
  PLC_CONTROL = 0x49,
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
  /** FC 0x49 only: a RUN request was refused because the hardware mode
   *  switch reads STOP. */
  REFUSED_BY_SWITCH = 0x83,
}

/** FC 0x49 sub-commands. */
export enum PlcControlSubcommand {
  /** Report state + switch position, change nothing. */
  QUERY = 0x00,
  /** Arg byte: 0 = STOP, 1 = RUN. */
  SET_STATE = 0x01,
}

/** Runtime states reported by FC 0x49 (and by Runtime v4's `/api/status`). */
export enum PlcRuntimeState {
  STOPPED = 0,
  RUNNING = 1,
  ERROR = 2,
}

/** Mode-switch positions reported by FC 0x49. Boards with no physical
 *  switch always report RUN. */
export enum PlcSwitchPosition {
  STOP = 0,
  RUN = 1,
}
