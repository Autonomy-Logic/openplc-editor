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
  /** Transports the target can serve, in the order the UI should offer them.
   *  Empty means the target serves no Modbus at all, which is what hides the
   *  screen — there is no separate flag, because a server that answers on
   *  nothing and a target that cannot serve are the same absence. */
  transports: ModbusServerTransport[]

  /** Segments this target actually has. Absent segments are not rendered and
   *  never appear in the address map — a `%MX` row on an Arduino is a lie. */
  segments: ModbusSegment[]

  /** The user sizes the buffers. On a `plc-server` target this is always true.
   *  On a baremetal target it is true only when the board's package declares
   *  BOTH its firmware defaults and a ceiling to raise them to -- otherwise
   *  there is nothing the user could change and the screen shows the counts
   *  read-only. */
  configurableBuffers: boolean

  /** Lowest value each segment may take. On a baremetal target this is the
   *  firmware default, because these counts also dimension the IEC pointer
   *  arrays and shrinking one drops I/O with no diagnostic; growth is the only
   *  direction offered. `null` where there is no floor. */
  minCounts: ModbusSegmentCounts | null

  /** Highest value each segment may take, from the board's declared ceilings.
   *  `null` where the target imposes none. */
  maxCounts: ModbusSegmentCounts | null

  /** The user picks the TCP listen port. False where the firmware hard-codes
   *  it (baremetal listens on 502 in three places in `modbus_tcp.cpp`). */
  configurablePort: boolean

  /** The user picks which local interface the server binds to. Meaningless on
   *  a microcontroller with one network interface. */
  configurableBindAddress: boolean

  /** UARTs the board declares, for the RTU port picker. Empty when the package
   *  declares none, in which case the picker falls back to its static list --
   *  refusing RTU on a board whose UART set nobody has confirmed would remove a
   *  configuration that works today. */
  serialPorts: string[]

  /** The UART the editor's own connection lands on. RTU may use it, and the
   *  firmware then serves the debugger and the register table there together,
   *  but the package owns that port's speed and slave id: they are what the
   *  editor dials, and a project that changed them would lock itself out. */
  defaultSerial: string

  /** TCP port the server answers on. Authoritative when `configurablePort` is
   *  false; otherwise the default for a newly created server. */
  fixedPort: number

  /** Buffer counts to display when `configurableBuffers` is false. `null` only
   *  on a target that serves no Modbus at all; a baremetal board always has
   *  counts, because the firmware always compiles with some. */
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
