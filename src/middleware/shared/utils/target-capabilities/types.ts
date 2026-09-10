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

/**
 * Per-target OPC-UA server dimensions for the BAREMETAL runtime.
 *
 * Why this is a capability block and not constants in the runtime: the
 * baremetal OPC-UA server is one implementation compiled to fit the part,
 * and only the VPP knows the silicon. A TM4C1294 has no crypto accelerator,
 * no TRNG and no RTC, so it builds with encryption and certificates out —
 * which is not a smaller feature set for its own sake, it is ~60-100 KB of
 * flash, ~20-40 KB of RAM and the whole software-RSA CPU cost never entering
 * the image. An ESP32 has all three in hardware and turns them on. Neither
 * fact belongs in a `#ifdef BOARD_*` — see `logo-code-placement`: capability
 * defines, never board names.
 *
 * Every field lands in the generated `src/opcua_config.h` as an `OPCUA_*`
 * define, so the runtime reads only what it was told.
 *
 * RAM accounting, because it is the whole reason these numbers are declared
 * rather than inferred: OPC-UA Part 6 §6.7.1 requires a conformant server to
 * accept and emit an 8192-byte chunk, so each concurrent session costs
 * 8 KB receive + 8 KB send = **16 KB**, and nothing else in the design comes
 * close. `maxSessions` is therefore the expensive dimension and defaults to
 * **1**; a VPP must opt in to more, with that cost in mind.
 */
export interface OpcUaTargetProfile {
  /** Bytes of the static arena that backs `UA_malloc` / `UA_free`.
   *
   *  A fixed arena rather than the newlib heap for three reasons: it is a hard
   *  cap by construction, it fails at LINK time (it is a `static` array, so
   *  `arduino-cli` reports the overflow in the same line the user already
   *  reads) rather than in the field, and it cannot fragment the heap the user
   *  program is allocating from over months of uptime. */
  arenaBytes: number

  /** Ceiling on nodes in the generated address space, enforced by the editor
   *  before the build rather than discovered on a device that stops answering.
   *
   *  This is a FLASH budget, not a RAM one: the address space is served from
   *  `const` flash tables and materialised into `nodePoolSlots` on demand, so
   *  a four-figure value is reasonable even on a 248 KB part. */
  maxNodes: number

  /** Concurrent OPC-UA sessions. 16 KB of protocol-mandated buffers each —
   *  the dominant RAM term. Default 1. */
  maxSessions: number

  /** RAM slots for materialising flash-resident nodes on demand. What has to
   *  be in RAM is not the node count but how many nodes are held at once,
   *  which the operation limits below already bound. */
  nodePoolSlots: number

  /** OPC-UA `ServerCapabilities.OperationLimits`, published so conformant
   *  clients split their own requests, and enforced so the rest get
   *  `Bad_TooManyOperations` instead of exhausting the arena. This is the
   *  protocol's own answer to "the client asked for 1000 nodes at once" —
   *  the same discipline the Modbus debugger gets from a 253-byte PDU, only
   *  negotiated instead of implicit. */
  maxNodesPerRead: number
  maxNodesPerWrite: number
  maxNodesPerBrowse: number
  /** References returned per node before the client must continue with
   *  `BrowseNext` and a continuation point. */
  maxReferencesPerNode: number
  /** Longest array a single node may expose. An array node is the one case
   *  where a value must be materialised whole (a 1000-element DINT is 4 KB),
   *  so unlike every other node it needs a real bound. */
  maxArrayLength: number

  /** Highest security mode the target can actually sustain. `'none'` keeps
   *  mbedTLS out of the link entirely. Anything above it requires
   *  `hw.trng` — shipping SignAndEncrypt on a weak RNG is worse than
   *  shipping None honestly. */
  security: 'none' | 'sign' | 'sign-and-encrypt'

  /** X.509 server certificate + client trust list. Requires `hw.rtc`:
   *  `notBefore` / `notAfter` cannot be checked against an uptime counter. */
  certificates: boolean

  /** Data-change subscriptions (the Micro Embedded Device profile's addition
   *  over Nano). Off means Nano only — clients must poll. */
  subscriptions: boolean

  /** PBKDF2-HMAC-SHA256 work factor for username/password auth.
   *
   *  The editor hashes at 600 000 iterations, which is right for a Linux
   *  runtime and ~15 s of software SHA-256 on a 120 MHz Cortex-M4 — long
   *  enough to stall the scan through an entire ActivateSession. The runtime
   *  chunks the KDF across scan cycles regardless, so this only sets how much
   *  login LATENCY the target pays: parts with `hw.sha256` keep 600 000. */
  kdfIterations: number

  /** Hardware facts about the part. These gate the fields above; they are
   *  not user preferences. */
  hw: {
    sha256: boolean
    aes: boolean
    /** Public-key accelerator (RSA / ECC). Without it a Basic256Sha256
     *  handshake is software RSA-2048. */
    pk: boolean
    trng: boolean
    rtc: boolean
  }
}

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

  /** Baremetal OPC-UA server dimensions. Meaningful only where
   *  `opcuaServer` is true AND the target compiles the baremetal runtime —
   *  Runtime v4 and the Simulator host OPC-UA through entirely different
   *  machinery and ignore this. Optional so a VPP declares only what it
   *  overrides; `resolveTargetCapabilities` fills the rest from
   *  `DEFAULT_OPCUA_PROFILE`. */
  opcua?: OpcUaTargetProfile

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
