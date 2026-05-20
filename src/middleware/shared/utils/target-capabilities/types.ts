/**
 * Per-target capability matrix. Drives every UI affordance, build-flow
 * behavior, and runtime feature gate that depends on which board the
 * project is currently targeting.
 *
 * Two reasons this isn't `PlatformCapabilities` (which already exists
 * in middleware):
 *
 *   - `PlatformCapabilities` describes the *host* (desktop vs web vs
 *     test). Stable across the whole editor session.
 *   - `TargetCapabilities` describes the *currently selected board*.
 *     Changes every time the user picks a different target.
 *
 * Both byte-identical between openplc-editor and openplc-web. The
 * platforms differ only in *how* they obtain a BoardInfo (hals.json
 * + VPP merger on desktop; orchestrator devices on web), not in how
 * its capabilities are read.
 */

/**
 * Wire protocols a target can speak to the debugger.
 *
 *   - modbus-serial: Modbus RTU over USB / virtual serial. Used by
 *     Arduino targets and the in-process Simulator.
 *   - modbus-tcp:    Modbus TCP. Used by Runtime v3 and Arduino with
 *     an ethernet shield.
 *   - websocket:     Runtime v4 native debug channel.
 *
 * All three paths share the same payload protocol; only the
 * transport differs.
 */
export type DebuggerTransport = 'modbus-serial' | 'modbus-tcp' | 'websocket'

export interface TargetCapabilities {
  /* ---------------------------------------------------------------
   * Address producers — sources that allocate IEC addresses and
   * therefore participate in the address pool when their target is
   * active. Switching to a target where a producer is `false` makes
   * the addresses it would have claimed available again.
   * --------------------------------------------------------------- */

  /** Arduino-style fixed-address pin mapping (hardware-bound). */
  pinMapping: boolean

  /** VPP module slots (e.g. SLM-RP4 backplane modules). */
  vppIo: boolean

  /** Modbus TCP slave remote devices. */
  modbusTcpRemote: boolean

  /** EtherCAT slaves. */
  ethercat: boolean

  /* ---------------------------------------------------------------
   * Server protocols — expose existing IEC addresses to external
   * clients. They don't produce addresses, so they don't enter the
   * address pool, but they're gated the same way feature-wise.
   *
   * The Simulator reports `true` for every server even though it
   * runs them as no-ops at the bytecode level. The rationale is
   * UX: a project authored for Runtime v4 shouldn't drop its
   * server config when the user picks Simulator to test it.
   * --------------------------------------------------------------- */

  modbusTcpServer: boolean
  opcuaServer: boolean
  s7Server: boolean

  /* ---------------------------------------------------------------
   * Build / runtime behavior
   * --------------------------------------------------------------- */

  /** Which wire protocols the target supports for the debugger. */
  debuggerTransports: DebuggerTransport[]

  /** Python function blocks compile and run on the target (Runtime
   *  v3 / v4 both support them natively; Simulator compiles them as
   *  no-op stubs; Arduino-CLI targets reject them at build time). */
  pythonFunctionBlocks: boolean

  /** Monaco surfaces Arduino API completions when authoring C
   *  blocks. Arduino-CLI targets + Simulator (mega-based). */
  arduinoApiCompletions: boolean

  /** Runtime v4 stats panel (scan cycle, plugin stats, EtherCAT
   *  stats when applicable). VPP packages can layer their own stats
   *  on top via their screen-definition mechanism; that lives on the
   *  manifest, not here. */
  hasRuntimeStats: boolean

  /** Target is the built-in in-process Simulator. Distinct from
   *  `PlatformCapabilities.hasInProcessSimulator`, which is about
   *  whether the host *can* run a simulator. */
  isInProcessSimulator: boolean

  /** Upload happens over a local connection (USB / loopback) and
   *  doesn't require a separate "Connect" step. Arduino-CLI + the
   *  in-process Simulator. Runtime v3 / v4 require an established
   *  network connection. */
  directUsbUpload: boolean
}
