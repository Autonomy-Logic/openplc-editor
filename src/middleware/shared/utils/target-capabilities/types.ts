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

/** Per-target OPC-UA server dimensions for the baremetal runtime. */
export interface OpcUaTargetProfile {
  /** Bytes of the static arena that backs `UA_malloc` / `UA_free`. */
  arenaBytes: number

  /** Concurrent OPC-UA sessions. 16 KB of protocol-mandated buffers each —
   *  the dominant RAM term. Default 1. */
  maxSessions: number

  /** RAM slots for materialising flash-resident nodes on demand. What has to be
   *  in RAM is how many nodes are held at once, which the operation limits bound. */
  nodePoolSlots: number

  /** OPC-UA `ServerCapabilities.OperationLimits`, published so conformant
   *  clients split their own requests, and enforced so the rest get
   *  `Bad_TooManyOperations` instead of exhausting the arena. */
  maxNodesPerRead: number
  maxNodesPerWrite: number
  maxNodesPerBrowse: number
  /** References returned per node before the client must continue with
   *  `BrowseNext` and a continuation point. */
  maxReferencesPerNode: number
  /** Longest array a single node may expose. An array node is the one case where
   *  a value must be materialised whole, so it needs a real bound. */
  maxArrayLength: number

  /** Highest security mode the target can sustain. `'none'` keeps mbedTLS out of
   *  the link entirely; anything above it requires `hw.trng`. */
  security: 'none' | 'sign' | 'sign-and-encrypt'

  /** X.509 server certificate + client trust list. Requires `hw.rtc`:
   *  `notBefore` / `notAfter` cannot be checked against an uptime counter. */
  certificates: boolean

  /** Data-change subscriptions (the Micro Embedded Device profile's addition
   *  over Nano). Off means Nano only — clients must poll. */
  subscriptions: boolean

  /** PBKDF2-HMAC-SHA256 work factor for username/password auth. Only meaningful
   *  when `passwordScheme` is `pbkdf2-sha256`; 600 000 is the OWASP figure and
   *  what Runtime v4 uses. */
  kdfIterations: number

  /** How the build turns a project's plaintext password into what this target
   *  stores and compares against. A device property, not an editor preference.
   *
   *  - `pbkdf2-sha256` — the string Runtime v4 consumes. The default.
   *  - `plain` — for parts with no crypto acceleration, where PBKDF2 at a secure
   *    iteration count costs seconds of stalled scan. */
  passwordScheme: 'pbkdf2-sha256' | 'plain'

  /** Hardware facts about the part. These gate the fields above; they are
   *  not user preferences. */
  hw: {
    sha256: boolean
    aes: boolean
    /** Public-key accelerator (RSA / ECC). */
    pk: boolean
    trng: boolean
    rtc: boolean
  }
}

/** Baremetal S7Comm server dimensions, the same role `OpcUaTargetProfile` plays. */
export interface S7TargetProfile {
  /** Concurrent S7 connections; the expensive dimension. Each costs a
   *  receive/transmit PDU pair, so RAM is `2 * pduSize` per client. Runtime v4
   *  allows 32 as a Linux process with a thread each. */
  maxClients: number

  /** Negotiated S7 PDU ceiling, 240..960. */
  pduSize: number

  /** Ceiling on data blocks, enforced by the editor before the build. */
  maxDataBlocks: number

  /** Build the System Status List / identification service at all. */
  szl: boolean

  /** Serve Write Var at all. A read-only server is cheaper and, for a protocol
   *  with no authentication, often the right default on a plant network. The
   *  refusal is a proper S7 error, not a dropped connection. */
  writeEnabled: boolean

  /** Mapping types this target's S7 server can address. Bare metal declares an
   *  array for seven of the fourteen; v4's plugin accepts all. A block naming
   *  anything else is dropped before the build, not on the device. */
  buffers: readonly string[]
}

export interface TargetCapabilities {
  /** Arduino-style fixed-address pin mapping (hardware-bound). */
  pinMapping: boolean

  /** VPP module slots (e.g. SLM-RP4 backplane modules). */
  vppIo: boolean

  /** The target runs a Modbus TCP master, so a remote device can poll a slave
   *  over the network. On baremetal a VPP manifest raises it. */
  modbusTcpMaster: boolean

  /** The target runs a Modbus RTU master over a UART. On baremetal the family
   *  can; the master profile narrows it to boards with a UART besides the
   *  debugger's. A VPP manifest cannot set it (the resolver ignores it on a VPP
   *  board); built-in hals.json entries do. */
  modbusRtuMaster: boolean

  /** EtherCAT slaves. */
  ethercat: boolean

  modbusTcpServer: boolean

  /** The target can serve Modbus as an RTU slave over one of its hardware UARTs. */
  modbusRtuServer: boolean

  opcuaServer: boolean
  s7Server: boolean

  /** Sockets the baremetal network stack can hold open at once, as the VPP
   *  manifest declares them; `null` where nothing declares a count. */
  networkSockets: number | null

  /** Baremetal OPC-UA server dimensions. Meaningful only where `opcuaServer` is
   *  true and the target compiles the baremetal runtime. Optional so a VPP
   *  declares only what it overrides; `resolveTargetCapabilities` fills the rest
   *  from `DEFAULT_OPCUA_PROFILE`. */
  opcua?: OpcUaTargetProfile

  /** Baremetal S7Comm server dimensions. Meaningful only where `s7Server` is
   *  true and the target compiles the baremetal runtime. Optional so a VPP
   *  declares only what it overrides; `resolveTargetCapabilities` fills the rest
   *  from `DEFAULT_S7_PROFILE`. */
  s7?: S7TargetProfile

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

  /** Target implements the runtime run/stop state machine, so the Start/Stop control is meaningful. */
  plcStateControl: boolean

  /**
   * The target's runtime ships a BUILT-IN retain store the project can configure — the file-backed one in runtime
   * v4.
   */
  nativeRetainStore: boolean

  /** Upload happens over a local connection (USB / loopback) and
   *  doesn't require a separate "Connect" step. Arduino-CLI + the
   *  in-process Simulator. Runtime v3 / v4 require an established
   *  network connection. */
  directUsbUpload: boolean

  /** The selected board's VPP is sold as a licensed product, so the licensing flow runs for it. */
  isLicensable: boolean
}

/** The flags that decide which producers claim IEC addresses. */
export type AddressProducerCapabilities = Pick<
  TargetCapabilities,
  'pinMapping' | 'vppIo' | 'modbusTcpMaster' | 'modbusRtuMaster' | 'ethercat'
>

/** The servers a target actually runs — which decides whether their configured exposure reaches the device at all. */
export type ServerCapabilities = Pick<TargetCapabilities, 'modbusTcpServer' | 'opcuaServer' | 's7Server' | 's7'>
