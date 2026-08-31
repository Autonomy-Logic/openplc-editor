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

  /** How many slots of each IEC area this target's firmware can bind.
   *
   *  Sizes the process image: every `AT %…` location must fall inside
   *  it, and the firmware's buffer arrays / Modbus banks are declared
   *  from the same numbers (`defines.h` → `openplc.h`).
   *
   *  Per-target because the cost is RAM and the range of targets is
   *  wide: raising a limit grows the pointer arrays, each VPP HAL's
   *  binding tables, and the Modbus banks in lockstep, so a board with
   *  a 15-slot backplane and 256 KB of RAM and a board with 32 KB
   *  cannot share one number (openplc-editor#296).
   *
   *  **Optional, and absent on every preset — deliberately.** The
   *  firmware's own `openplc.h` already picks between two hardcoded
   *  sets with an `#ifdef` on the MCU: 8 DI / 6 AI / no `%M` area on
   *  the small AVRs (Uno, Leonardo, Micro — 2 KB of SRAM), 56/32/20 on
   *  everything else. A preset cannot answer for both halves of that
   *  ladder, and declaring the 56-series as "the default" would hand a
   *  Uno seven times the buffers it has RAM for. So absent means "say
   *  nothing in `defines.h` and let the firmware's `#ifdef` decide" —
   *  which is byte-for-byte today's behaviour for every board that
   *  ships without a VPP manifest.
   *
   *  A VPP manifest declares it for hardware whose real capacity it
   *  knows, and that declaration overrides the firmware default. */
  processImage?: ProcessImageSizes
}

/**
 * Slot counts of the firmware process image, one per IEC area/width.
 *
 * Names mirror the `MAX_*` macros the Arduino firmware declares its
 * buffers from (`resources/sources/arduino/openplc.h`) — the emitter in
 * `generate-defines.ts` maps these fields onto those macros one-to-one,
 * so a field added here needs a macro there and vice versa.
 *
 * Units are SLOTS, not bytes: `digitalInputs: 56` means `%IX0.0`
 * through `%IX6.7` are bindable, `memoryWords: 20` means `%MW0`
 * through `%MW19`.
 *
 * Every field is required. A partial process image is not a meaningful
 * thing to declare — the fields are not independent (the firmware sizes
 * one Modbus holding bank from `analogOutputs + memoryWords`), and an
 * omitted field silently reading as 0 would disable an entire area.
 * `resolveTargetCapabilities` merges this object wholesale for the same
 * reason: a manifest declares all of it or none of it. The manifest
 * schema enforces the same rule (`required` on all nine fields), so the
 * two ends cannot drift into a half-declared image.
 */
export interface ProcessImageSizes {
  /** `%IX` bit slots — `MAX_DIGITAL_INPUT`. Rounded up to a byte by the firmware. */
  digitalInputs: number
  /** `%QX` bit slots — `MAX_DIGITAL_OUTPUT`. Rounded up to a byte by the firmware. */
  digitalOutputs: number
  /** `%IW` word slots — `MAX_ANALOG_INPUT`. */
  analogInputs: number
  /** `%QW` word slots — `MAX_ANALOG_OUTPUT`. */
  analogOutputs: number
  /** `%ID` REAL slots — `MAX_REAL_INPUT`. */
  realInputs: number
  /** `%QD` REAL slots — `MAX_REAL_OUTPUT`. */
  realOutputs: number
  /** `%MW` word slots — `MAX_MEMORY_WORD`. */
  memoryWords: number
  /** `%MD` dword slots — `MAX_MEMORY_DWORD`. */
  memoryDwords: number
  /** `%ML` lword slots — `MAX_MEMORY_LWORD`. */
  memoryLwords: number
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
