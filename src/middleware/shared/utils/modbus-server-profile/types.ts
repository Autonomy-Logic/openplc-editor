/**
 * What a given target's Modbus **server** (slave) can actually do.
 *
 * `TargetCapabilities` answers "is this feature available at all", and stays a
 * flat matrix of booleans on purpose. This answers a different, shapier
 * question — which transports, which IEC segments, which fields are the user's
 * to set — and lives in its own resolver so the capability matrix does not grow
 * five booleans that only mean something together.
 *
 * The distinction is not cosmetic. Runtime v4 and a baremetal Arduino both
 * "have" a Modbus server, but almost nothing about the two is the same:
 *
 *   - v4 serves TCP only, on a port and bind address the user picks, with
 *     buffer sizes the user sizes and the plugin honours through
 *     `conf/modbus_slave.json`.
 *   - Baremetal serves RTU and/or TCP, always on port 502 (hard-coded in
 *     `modbus_tcp.cpp`), with buffer sizes fixed at compile time by the MCU's
 *     `MAX_*` constants in `arduino/openplc.h` — which also size the IEC
 *     pointer arrays, so they are not a Modbus setting at all.
 *   - Baremetal has no `%MX` segment: `init_mbregs` is called with
 *     `MAX_DIGITAL_OUTPUT` as the coil count, and no `bool_memory` array
 *     exists.
 *
 * One screen renders both, so the differences have to be data.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

/** Wire transports a Modbus server can answer on. */
export type ModbusServerTransport = 'rtu' | 'tcp'

/**
 * IEC segments a Modbus block can expose, in the order they are laid out
 * within that block. Both the Runtime v4 plugin and the baremetal firmware
 * lay holding registers out as `%QW` then `%MW` then `%MD` (two registers
 * each) then `%ML` (four) — see `modbus_registers.cpp#readRegisters` and
 * `simple_modbus.py`.
 */
export type ModbusSegment = 'QW' | 'MW' | 'MD' | 'ML' | 'QX' | 'MX' | 'IX' | 'IW'

/**
 * Where the Modbus server's settings are persisted for this target.
 *
 *   - `plc-server`: a project-scoped `PLCServer` element, written to
 *     `devices/servers/<name>.json`. Runtime v4 and the Simulator.
 *   - `vendor-screen`: the board-scoped VPP screen state under
 *     `vendorScreenData`, keyed by section id. Baremetal.
 *   - `none`: the target serves no Modbus server.
 *
 * This is the fork the whole unified screen turns on, and it is deliberately
 * NOT a boolean: a third store would be a third value here, not a second
 * branch at every call site.
 */
export type ModbusServerStore = 'plc-server' | 'vendor-screen' | 'none'

/** Buffer counts, in IEC values (not Modbus addresses). */
export interface ModbusSegmentCounts {
  QW: number
  MW: number
  MD: number
  ML: number
  QX: number
  MX: number
  IX: number
  IW: number
}

export interface ModbusServerProfile {
  /** Which store the screen reads and writes. `none` hides the screen. */
  store: ModbusServerStore

  /** Transports the target can serve, in the order the UI should offer them. */
  transports: ModbusServerTransport[]

  /** Segments this target actually has. Absent segments are not rendered and
   *  never appear in the address map — a `%MX` row on an Arduino is a lie. */
  segments: ModbusSegment[]

  /** The user sizes the buffers. False where the sizes are compile-time
   *  constants of the firmware; the screen then shows them read-only. */
  configurableBuffers: boolean

  /** The user picks the TCP listen port. False where the firmware hard-codes
   *  it (baremetal listens on 502 in three places in `modbus_tcp.cpp`). */
  configurablePort: boolean

  /** The user picks which local interface the server binds to. Meaningless on
   *  a microcontroller with one network interface. */
  configurableBindAddress: boolean

  /** TCP port the server answers on. Authoritative when `configurablePort` is
   *  false; otherwise the default for a newly created server. */
  fixedPort: number

  /** Buffer counts to display when `configurableBuffers` is false. `null`
   *  when the target's sizes are not known — the board's VPP has not declared
   *  them — in which case the screen says so instead of inventing a map. */
  derivedCounts: ModbusSegmentCounts | null

  /** The board carries its RTU/TCP hardware settings in VPP screens the
   *  package ships. The unified screen links out to these rather than
   *  duplicating baud rates and Wi-Fi credentials it does not own. */
  vppScreens: {
    /** Screen name declaring the always-on serial port, if any. */
    serial?: string
    /** Screen name declaring Ethernet / Wi-Fi bring-up, if any. */
    network?: string
    /** Screen name declaring the Modbus sections themselves. */
    modbus?: string
  }
}
