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

  /** Target implements the runtime run/stop state machine, so the
   *  Start/Stop control is meaningful.  Runtime v3 AND v4 drive it over
   *  the same REST API (`/api/start-plc`, `/api/stop-plc`, both
   *  JWT-authenticated); arduino-cli targets drive it over the device
   *  connection (Modbus FC 0x4b).  Only the Simulator is excluded, and
   *  only because it keeps its dedicated start/stop path.
   *
   *  Runtime v3 having its own web UI is NOT a reason to exclude it: the
   *  editor's REST access is unaffected by that, the editor has shipped
   *  this button working against v3, and gating it off here made Start /
   *  Stop a silent no-op on a target where it had always worked. */
  plcStateControl: boolean

  /** The target's runtime ships a BUILT-IN retain store the project can
   *  configure — the file-backed one in runtime v4. True only there: on
   *  baremetal the store is whatever the board's driver provides and nothing in
   *  the project can point it anywhere, so a Persistent Storage screen would
   *  offer settings no one reads.
   *
   *  This gates the SCREEN, offline and with no device attached. It is not the
   *  same question as whether retention works at all — a VPP shipping its own
   *  store gives a target retention while declaring
   *  `hidesNativeScreens: ['persistent-storage']`, which removes the screen and
   *  suppresses `retain.conf` so the vendor's driver is the only store. */
  nativeRetainStore: boolean

  /** Upload happens over a local connection (USB / loopback) and
   *  doesn't require a separate "Connect" step. Arduino-CLI + the
   *  in-process Simulator. Runtime v3 / v4 require an established
   *  network connection. */
  directUsbUpload: boolean

  /** The selected board's VPP is sold as a licensed product, so the
   *  licensing flow runs for it.  Flows verbatim from the VPP manifest's
   *  `device.capabilities.isLicensable`, exactly like `vppIo`.
   *
   *  This is THE gate on the whole flow, and the reason it is a
   *  capability rather than an inference: when it is `false` a connect is
   *  an ordinary connect — no anchor read beyond the usual
   *  classification, no license FCs, no backend call. Every board that
   *  does not declare it is `false`, which is every built-in hals.json
   *  board, plain Runtime v3/v4, Linux, Arduino, and the Simulator.
   *
   *  There is deliberately NO companion "can this board store a licence"
   *  capability. Every licensable VPP targets hardware that persists a
   *  licence across a reboot — that is a product rule, not something a
   *  manifest gets to vary — so the answer would be `true` wherever
   *  `isLicensable` is true and irrelevant everywhere else. What the
   *  build actually needs is the storage SOURCE, which travels as
   *  `BoardBuildInfo.licenseStoreFiles`; a second derived boolean on top
   *  of it bought one diagnostic sentence and one more way for two
   *  representations of one fact to disagree.
   *
   *  A licensable board that answers `LIC_UNSUPPORTED` on the wire is
   *  therefore a FIRMWARE fault (built without the backend), never a
   *  hardware limitation — and the flow says exactly that. */
  isLicensable: boolean
}

/**
 * The four flags that decide which producers claim IEC addresses.
 *
 * Address-space code reads nothing else, so it takes this narrower type and a
 * full `TargetCapabilities` is assignable to it. The point of the narrowing is
 * that "which producers are active" can also be answered by something that is
 * NOT a target — see `ALL_ADDRESS_PRODUCERS_ACTIVE`.
 */
export type AddressProducerCapabilities = Pick<
  TargetCapabilities,
  'pinMapping' | 'vppIo' | 'modbusTcpRemote' | 'ethercat'
>
