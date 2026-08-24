export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
  DEBUG_GET_STATUS = 0x46,
  DEBUG_GET_VERSION = 0x47,
  DEBUG_GET_BOARD_ID = 0x48,
  /** Store a license blob on the device (VPP licensing). Write-only: the read
   *  back is DEBUG_READ_LICENSE, and it is a SEPARATE round trip on purpose —
   *  0x49 only stores bytes, it validates nothing. */
  DEBUG_WRITE_LICENSE = 0x49,
  /** Read the stored license blob back off the device. */
  DEBUG_READ_LICENSE = 0x4a,
  /** Set the runtime run/stop state. Reads go through DEBUG_GET_STATUS (0x46),
   *  which already reports the state — there is deliberately no second FC for
   *  querying it. */
  PLC_SET_STATE = 0x4b,
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
  /** DEBUG_READ_LICENSE only: virgin storage — no license has been provisioned. */
  LIC_EMPTY = 0x83,
  /** DEBUG_READ_LICENSE only: the magic matched but the crc32 did not. */
  LIC_CORRUPT = 0x84,
  /** Licensing FCs: the target has no on-device license-store backend at all.
   *  A valid device state, not a transport failure. */
  LIC_UNSUPPORTED = 0x85,
  /** PLC_SET_STATE only: a RUN request was refused because the hardware mode
   *  switch reads STOP. */
  REFUSED_BY_SWITCH = 0x86,
  /** DEBUG_SET only: the target refused to write or force this variable because
   *  it is an IEC `CONSTANT`.
   *
   *  Mirrors `STATUS_READ_ONLY` in STruC++'s `debug_dispatch.hpp`. A constant is
   *  emitted as a `const` C++ member and the debug table reaches it through a
   *  cast that strips the qualifier, so the runtime is what refuses — which is
   *  what keeps an older editor build, or an OPC-UA client, from writing
   *  through to it. */
  READ_ONLY = 0x87,
}

/** Runtime states reported by DEBUG_GET_STATUS and PLC_SET_STATE (and by
 *  Runtime v4's `/api/status`). */
export enum PlcRuntimeState {
  STOPPED = 0,
  RUNNING = 1,
  ERROR = 2,
}

/** Mode-switch positions. Boards with no physical switch always report RUN, so
 *  callers need no "absent" case. */
export enum PlcSwitchPosition {
  STOP = 0,
  RUN = 1,
}
