# Simulator Mode: rp2040js Integration Plan

## Overview

Add a built-in simulator to OpenPLC Editor using [Wokwi's rp2040js](https://github.com/wokwi/rp2040js) (MIT, zero dependencies, ~200KB). The simulator appears as a device in the board list. When selected, "Build" compiles for RP2040, loads the UF2 firmware into the emulated CPU, and starts execution. "Debugger" connects via Modbus RTU over the emulated UART — identical to real hardware.

The user never sees any emulation details. They press Build, the code compiles and runs. They press Debugger, values appear.

---

## 1. New Device Entry in hals.json

**File:** `resources/sources/boards/hals.json`

Add a new entry at the **top** of the JSON (so it appears first in the device dropdown):

```json
{
  "OpenPLC Simulator": {
    "compiler": "simulator",
    "core": "rp2040:rp2040",
    "board_manager_url": "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json",
    "c_flags": ["-MMD", "-c", "-Wno-incompatible-pointer-types"],
    "extra_libraries": [],
    "platform": "rp2040:rp2040:rpipico",
    "source": "rp2040pico.cpp",
    "preview": "simulator.png",
    "specs": {
      "CPU": "Emulated RP2040 ARM Cortex-M0+",
      "RAM": "264 KB",
      "Flash": "2 MB",
      "Note": "Built-in simulator - no hardware required"
    }
  },
  ...existing entries...
}
```

Key decisions:
- **`"compiler": "simulator"`** — new compiler type, distinct from `"arduino-cli"` and `"openplc-compiler"`. This is the discriminator used throughout the codebase to determine behavior.
- Reuses the real Raspberry Pico `core`, `platform`, and `source` (rp2040pico.cpp) because compilation is identical.
- Pin mapping defaults match the Raspberry Pico HAL (DI: 6-13, DO: 14-21, AI: 26-28, AO: 4-5).

---

## 2. Device Type Utility Functions

**File:** `src/utils/device.ts`

Add a new utility function alongside the existing `isArduinoTarget` and `isOpenPLCRuntimeTarget`:

```typescript
export function isSimulatorTarget(boardInfo: AvailableBoardInfo | undefined): boolean {
  if (!boardInfo) return false
  return boardInfo.compiler === 'simulator'
}
```

This function will be used across the UI to conditionally hide/show configuration fields.

---

## 3. Default Device for New Projects

**File:** `src/renderer/store/slices/device/data/constants.ts`

Change the default device board from `'OpenPLC Runtime v3'` to `'OpenPLC Simulator'`:

```typescript
defaultDeviceConfiguration: DeviceConfiguration = {
  deviceBoard: 'OpenPLC Simulator',  // was 'OpenPLC Runtime v3'
  ...rest unchanged...
}
```

This ensures every new project starts with the simulator selected, so users can build and debug immediately.

---

## 4. Device Editor UI — Hide Configuration for Simulator

**File:** `src/renderer/components/_features/[workspace]/editor/device/configuration/board.tsx`

The board.tsx component currently branches on `isOpenPLCRuntimeTarget(currentBoardInfo)`:
- If runtime target → shows IP address field, Connect button, scan cycle stats
- If arduino target → shows Communication Port dropdown, board specs, Pin Mapping table

For the simulator, **none of these should appear**. The board panel should show:
- The Device dropdown (so users can switch away from simulator)
- The board preview image (`simulator.png`)
- A simple message like "Built-in simulator — no configuration required"
- No communication port selector
- No IP address field
- No Connect button
- No pin mapping table (pins are fixed by the HAL)
- No Compile Only checkbox

Implementation: Add an `isSimulatorTarget(currentBoardInfo)` check at the top of the render logic:

```
Line 361: {isOpenPLCRuntimeTarget(currentBoardInfo) ? (
```

Change to a three-way branch:

```
{isSimulatorTarget(currentBoardInfo) ? (
  <SimulatorInfo />  // Simple component showing "Built-in simulator" message
) : isOpenPLCRuntimeTarget(currentBoardInfo) ? (
  ... existing runtime UI ...
) : (
  ... existing arduino UI ...
)}
```

Similarly, the section after `<hr>` (line 488) that shows either scan-cycle stats or pin-mapping should show nothing (or a brief description) for the simulator.

**File:** `src/renderer/components/_features/[workspace]/editor/device/configuration/communication.tsx`

The Communication panel (Modbus RTU/TCP checkboxes and config) should be completely hidden when the simulator is selected. The simulator handles Modbus RTU internally and automatically.

Implementation: Early return or conditional render:
```tsx
if (isSimulatorTarget(currentBoardInfo)) {
  return (
    <DeviceEditorSlot heading='Communication'>
      <p>Modbus RTU is automatically configured for the simulator.</p>
    </DeviceEditorSlot>
  )
}
```

---

## 5. Compilation Flow — Handle Simulator Target

### 5a. Compiler Module Changes (Build Button Only)

**File:** `src/main/modules/compiler/compiler-module.ts`

The `compileProgram()` method (line 1341) needs a new branch for `compiler === 'simulator'`. The compilation pipeline is:

1. **Steps 1-10 are identical to Arduino/RP2040** — XML generation, xml2st, iec2c, debug.c, LOCATED_VARIABLES.h, C/C++ blocks. The simulator uses the exact same `rp2040pico.cpp` HAL and `rp2040:rp2040:rpipico` platform.

2. **Step 11 (Arduino CLI compile)** — also identical. The simulator target still calls `arduino-cli compile` with the RP2040 core to produce a `.uf2` firmware binary. Arduino CLI must be installed.

3. **Step 12 (Upload) — this is where the simulator diverges.** Instead of calling `arduino-cli upload` to a serial port, the compiled `.uf2` file path is sent back to the renderer via the MessageChannel port so the renderer can load it into rp2040js.

Implementation in `compileProgram()`:

```typescript
// After successful Arduino CLI compilation...
if (boardRuntimeType === 'simulator') {
  // Find the compiled .uf2 file
  const uf2Path = path.join(buildDir, 'firmware.uf2')  // or wherever arduino-cli outputs it
  mainProcessPort.postMessage({
    logLevel: 'info',
    message: 'Compilation successful. Loading firmware into simulator...',
  })
  mainProcessPort.postMessage({
    simulatorFirmwarePath: uf2Path,
    closePort: true,
  })
  return
}
```

The `compileForDebugger()` method (line 2102) does **not** need a simulator-specific branch. This function only runs the first-stage compilation (XML → ST → C → debug metadata) and never invokes Arduino CLI or uploads anything. It works as-is for all targets, including the simulator.

### 5b. IPC Handler Changes

**File:** `src/main/modules/ipc/main.ts`

The `handleRunCompileProgram` handler (line 777) passes args to `compilerModule.compileProgram()`. The args array includes `boardTarget` at index 1. The compiler module will read the board info from hals.json and detect `compiler === 'simulator'` to route appropriately.

No IPC handler changes needed — the existing MessageChannel pattern already supports sending arbitrary data back to the renderer.

### 5c. Build Button Changes (Renderer)

**File:** `src/renderer/components/_organisms/workspace-activity-bar/default.tsx`

The build button handler (around line 267) calls `window.bridge.runCompileProgram(...)`. The callback receives messages from the compiler.

For the simulator target, the callback will receive a new message type: `{ simulatorFirmwarePath: string, closePort: true }`.

When this message arrives:
1. Read the UF2 file from the path
2. Load it into the rp2040js emulator instance (see Section 7)
3. Start emulator execution
4. Log "Simulator running" to the console

---

## 6. rp2040js Emulator Module

### 6a. New Module

**File:** `src/main/modules/simulator/simulator-module.ts` (NEW)

This module manages the rp2040js emulator lifecycle in the **main process**. It lives in main because the Modbus RTU client (which the debugger uses) runs in main.

```typescript
import { RP2040, loadUF2, USBCDC } from 'rp2040js'

class SimulatorModule {
  private mcu: RP2040 | null = null
  private running: boolean = false
  private executionTimer: NodeJS.Timer | null = null

  // Callbacks for UART bridge
  onUartByte: ((byte: number) => void) | null = null

  async loadAndRun(uf2Data: Buffer): Promise<void> {
    this.stop()

    this.mcu = new RP2040()
    this.mcu.loadBootrom(bootromB1)  // bundled bootrom
    loadUF2(new Uint8Array(uf2Data), this.mcu)

    // Wire UART0 output to the Modbus RTU bridge
    this.mcu.uart[0].onByte = (byte: number) => {
      this.onUartByte?.(byte)
    }

    // Start execution loop
    this.mcu.PC = 0x10000000
    this.running = true
    this.executeLoop()
  }

  feedByte(byte: number): void {
    this.mcu?.uart[0].feedByte(byte)
  }

  stop(): void {
    this.running = false
    if (this.executionTimer) {
      clearTimeout(this.executionTimer)
      this.executionTimer = null
    }
    this.mcu = null
  }

  isRunning(): boolean {
    return this.running
  }

  private executeLoop(): void {
    if (!this.running || !this.mcu) return
    // Execute a batch of cycles, then yield to event loop
    this.mcu.execute()  // runs until next yield point
    this.executionTimer = setTimeout(() => this.executeLoop(), 0)
  }
}
```

### 6b. Bootrom

The RP2040 bootrom binary (~16KB) needs to be bundled. Options:
- Include as a `.ts` file with the binary data exported as a Uint8Array (same pattern as rp2040js's `demo/bootrom.ts`)
- Place in `resources/` and load at runtime

Recommended: Bundle as a TypeScript constant in `src/main/modules/simulator/bootrom.ts` for simplicity and zero filesystem dependency.

### 6c. npm Dependency

```bash
npm install rp2040js
```

Add to `package.json` dependencies. The package is ~200KB, zero transitive dependencies, supports both ESM and CJS.

---

## 7. Modbus RTU Bridge for Simulator — VirtualSerialPort Approach

### Design Principle

Rather than duplicating the Modbus RTU protocol logic in a separate `SimulatorModbusClient` class, we create a `VirtualSerialPort` that mimics the `serialport` npm package's event-based API and adapts rp2040js's UART. The existing `ModbusRtuClient` is then reused unchanged — all CRC calculation, frame assembly, response parsing, retries, and timeout logic stays in one place.

This avoids code duplication and ensures any future bug fixes to the Modbus RTU protocol automatically apply to both physical hardware and the simulator.

### 7a. VirtualSerialPort

**File:** `src/main/modules/simulator/virtual-serial-port.ts` (NEW)

`ModbusRtuClient.serialPort` is typed as `any` and uses these `serialport` APIs:
- `on('open', cb)` / `on('data', cb)` / `on('error', cb)` / `once('error', cb)` — events
- `write(data, callback)` — send bytes
- `flush(callback)` — flush input buffer
- `close()` — close port
- `isOpen` — boolean state
- `removeListener(event, fn)` — cleanup

`VirtualSerialPort` extends `EventEmitter` and implements all of these, routing bytes through `SimulatorModule.feedByte()` (TX to device) and `SimulatorModule.onUartByte` (RX from device):

```typescript
import { EventEmitter } from 'events'
import { SimulatorModule } from './simulator-module'

export class VirtualSerialPort extends EventEmitter {
  public isOpen = false
  private simulator: SimulatorModule

  constructor(simulator: SimulatorModule) {
    super()
    this.simulator = simulator
  }

  open(): void {
    this.isOpen = true
    // Wire UART RX: bytes from emulated device → ModbusRtuClient via 'data' events
    this.simulator.onUartByte = (byte: number) => {
      this.emit('data', Buffer.from([byte]))
    }
    // Emit 'open' asynchronously (matches real SerialPort behavior)
    process.nextTick(() => this.emit('open'))
  }

  write(data: Uint8Array | Buffer, callback?: (err?: Error | null) => void): void {
    // Send each byte to the emulated UART TX (host → device)
    for (const byte of data) {
      this.simulator.feedByte(byte)
    }
    callback?.(null)
  }

  flush(callback?: (err?: Error | null) => void): void {
    // No hardware buffer to flush in virtual port
    callback?.(null)
  }

  close(): void {
    this.isOpen = false
    this.simulator.onUartByte = null
    this.removeAllListeners()
  }
}
```

**Why byte-by-byte emission works:** `ModbusRtuClient.sendRequest()` already accumulates bytes into `responseBuffer` via `Buffer.concat` and uses a 50ms frame-completion timeout to detect end-of-frame. Each byte resets the timer. Since the emulated CPU processes response bytes in batches (within the same `executeLoop()` tick), they arrive nearly instantly and the 50ms gap correctly signals frame completion.

**No bootloader delay:** Physical serial ports have a 2.5s bootloader delay after opening. The `VirtualSerialPort` skips this entirely — the emulated UART is ready immediately.

### 7b. ModbusRtuClient — Accept Injected Serial Port

**File:** `src/main/modules/modbus/modbus-rtu-client.ts` (MODIFIED — minimal change)

Add an optional `serialPort` field to the constructor options:

```typescript
interface ModbusRtuClientOptions {
  port: string
  baudRate: number
  slaveId: number
  timeout: number
  serialPort?: any  // Pre-built serial port (e.g. VirtualSerialPort for simulator)
}
```

Store it in the constructor and add an early branch in `connect()`:

```typescript
private injectedSerialPort: any = null

constructor(options: ModbusRtuClientOptions) {
  this.port = options.port
  this.baudRate = options.baudRate
  this.slaveId = options.slaveId
  this.timeout = options.timeout
  this.injectedSerialPort = options.serialPort ?? null
}

async connect(): Promise<void> {
  // If a pre-built serial port was provided (e.g. VirtualSerialPort), use it directly
  if (this.injectedSerialPort) {
    this.serialPort = this.injectedSerialPort
    return new Promise((resolve, reject) => {
      this.serialPort.on('open', () => resolve())
      this.serialPort.on('error', (err: Error) => reject(err))
      this.serialPort.open()
    })
  }
  // ...existing SerialPort creation code (unchanged)...
}
```

This is the **only change** to `ModbusRtuClient`. All protocol logic — `assembleRequest()`, `sendRequest()`, `calculateCrc()`, `getMd5Hash()`, `getVariablesList()`, `setVariable()` — remains untouched and is shared between physical hardware and the simulator.

### 7c. No Separate SimulatorModbusClient or Shared Utils Needed

This approach eliminates:
- ~~`simulator-modbus-bridge.ts`~~ — not needed, `ModbusRtuClient` is reused directly
- ~~`modbus-rtu-utils.ts`~~ — not needed, no protocol code to extract/share

---

## 8. Debugger Connection for Simulator

### 8a. IPC Handler — New Connection Type

**File:** `src/main/modules/ipc/main.ts`

The `handleDebuggerConnect` method (line 1114) currently supports `connectionType: 'tcp' | 'rtu' | 'websocket'`. Add `'simulator'`:

```typescript
handleDebuggerConnect = async (
  _event: IpcMainInvokeEvent,
  connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator',
  connectionParams: { ... }
): Promise<{ success: boolean; error?: string }>
```

New branch using `ModbusRtuClient` with `VirtualSerialPort` (no separate client class needed):

```typescript
case 'simulator':
  const virtualPort = new VirtualSerialPort(this.simulatorModule)
  this.debuggerModbusClient = new ModbusRtuClient({
    port: 'simulator',      // label only, not used for real I/O
    baudRate: 115200,
    slaveId: 1,
    timeout: 5000,
    serialPort: virtualPort, // injected virtual port
  })
  await this.debuggerModbusClient.connect()
  break
```

Since `ModbusRtuClient` is used directly, all existing debug polling logic (`handleDebuggerGetVariablesList`, `handleDebuggerVerifyMd5`, `handleDebuggerSetVariable`) works unchanged.

### 8b. Debugger Button — Simulator Flow (Corrected)

**File:** `src/renderer/components/_organisms/workspace-activity-bar/default.tsx`

The debugger button does **not** compile the full firmware. It only runs the first-stage compilation (`compileForDebugger`) to generate debug metadata and extract the MD5 hash. This is already the existing behavior for all targets — `compileForDebugger()` never invokes Arduino CLI or uploads anything.

For the simulator, there is one extra check: whether the simulator has firmware loaded. If the user has never pressed Build, the simulator is "empty" and there's nothing to debug.

**Complete simulator debugger flow:**

1. Detect `isSimulatorTarget` → skip all connection parameter checks (no IP, no port, no Modbus config)
2. **Check if simulator is "empty"** via `window.bridge.simulatorIsRunning()`
   - If empty (no firmware loaded) → show warning dialog: *"No firmware is running on the simulator. Would you like to build and upload the project first?"*
     - If user agrees → trigger full build (`runCompileProgram`), which compiles and auto-loads firmware into emulator. After build completes, restart the debugger flow from step 3.
     - If user declines → abort debugger
3. Run `compileForDebugger()` (first-stage only: XML → ST → C → debug files). **No simulator-specific branch needed** — this function works as-is for all targets.
4. Extract local MD5 from generated `program.st` (existing `debuggerReadProgramStMd5`)
5. Connect to simulator and get its MD5 via `debuggerVerifyMd5('simulator', {}, expectedMd5)` — uses Modbus RTU over virtual UART
6. **Compare MD5s** (existing logic):
   - If match → proceed to parse debug.c, build variable tree, connect debugger, start polling
   - If mismatch → show existing "Program Mismatch" dialog asking user to rebuild/upload. If user agrees, trigger full build and retry MD5 verification. (This is the same dialog that appears for real hardware when the running firmware doesn't match the current project.)

```typescript
// In handleDebuggerClick():
if (isSimulatorTarget(currentBoardInfo)) {
  // Check if simulator has firmware loaded
  const running = await window.bridge.simulatorIsRunning()
  if (!running) {
    const response = await window.bridge.showMessageDialog({
      type: 'warning',
      title: 'Simulator Empty',
      message: 'No firmware is running on the simulator. Would you like to build and upload the project first?',
      buttons: ['Build & Upload', 'Cancel'],
    })
    if (response === 0) {
      // Trigger full build (same as build button), then restart debugger flow
      // ...
    } else {
      setIsDebuggerProcessing(false)
      return
    }
  }
  connectionType = 'simulator'
  // Fall through to normal debug compilation + MD5 verification
}
```

### 8c. What Doesn't Change

- `compileForDebugger()` — works as-is, no simulator branch needed (first-stage only, no hardware)
- `handleMd5Verification()` — works as-is once `'simulator'` connection type is supported
- MD5 mismatch dialog — works as-is (triggers full build + retry)
- Debug file parsing, variable tree building, debug polling — all unchanged

---

## 9. New IPC Endpoints

**File:** `src/main/modules/ipc/main.ts` — add handlers
**File:** `src/main/modules/ipc/renderer.ts` — add renderer-side wrappers
**File:** `src/main/modules/preload/preload.ts` — expose via bridge

### New IPC Calls

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `simulator:load-firmware` | renderer → main | Load UF2 into emulator and start execution |
| `simulator:stop` | renderer → main | Stop the emulator |
| `simulator:is-running` | renderer → main | Check if emulator is currently running |

These are thin wrappers around `SimulatorModule` methods.

---

## 10. Firmware Modbus RTU Configuration

The existing RP2040 HAL (`resources/sources/hal/rp2040pico.cpp`) and the OpenPLC Arduino runtime already include Modbus RTU slave support. The compiler generates `defines.h` with Modbus configuration based on the device editor settings.

For the simulator, Modbus RTU must be **always enabled** with fixed defaults:
- Interface: `Serial` (UART0)
- Baud rate: `115200`
- Slave ID: `1`
- RS485 EN pin: none

**File:** `src/main/modules/compiler/compiler-module.ts`

In the code generation step that produces `defines.h`, when the target is `'simulator'`:

```c
#define MODBUS_ENABLED
#define MODBUS_RTU
#define MODBUS_RTU_INTERFACE Serial
#define MODBUS_RTU_BAUD 115200
#define MODBUS_RTU_SLAVE_ID 1
```

These defines are hardcoded regardless of what the device editor shows (which for the simulator shows nothing).

---

## 11. Assets

### Simulator Preview Image

**File:** `resources/sources/boards/images/simulator.png` (NEW)

Create a preview image for the simulator device. Suggestion: a stylized chip/CPU icon with a "play" symbol overlay to convey "virtual device." Should match the dimensions and style of existing board preview images.

---

## 12. File Summary

### New Files

| File | Purpose |
|------|---------|
| `src/main/modules/simulator/simulator-module.ts` | rp2040js emulator lifecycle management |
| `src/main/modules/simulator/virtual-serial-port.ts` | EventEmitter-based serial port mock that routes bytes through emulated UART |
| `src/main/modules/simulator/bootrom.ts` | Bundled RP2040 bootrom binary |
| `resources/sources/boards/images/simulator.png` | Device preview image |

### Modified Files

| File | Changes |
|------|---------|
| `resources/sources/boards/hals.json` | Add "OpenPLC Simulator" entry at top |
| `src/utils/device.ts` | Add `isSimulatorTarget()` function |
| `src/renderer/store/slices/device/data/constants.ts` | Change default device to "OpenPLC Simulator" |
| `src/renderer/components/_features/[workspace]/editor/device/configuration/board.tsx` | Hide comm port, pin mapping, IP address, Connect button for simulator |
| `src/renderer/components/_features/[workspace]/editor/device/configuration/communication.tsx` | Hide Modbus RTU/TCP config for simulator |
| `src/main/modules/compiler/compiler-module.ts` | Handle `compiler === 'simulator'` in compileProgram (skip upload, return UF2 path); force Modbus RTU defines |
| `src/main/modules/ipc/main.ts` | Add simulator IPC handlers; add `'simulator'` connection type to debugger |
| `src/main/modules/ipc/renderer.ts` | Add renderer wrappers for simulator IPC |
| `src/main/modules/preload/preload.ts` | Expose simulator bridge methods |
| `src/renderer/components/_organisms/workspace-activity-bar/default.tsx` | Handle simulator in build callback and debugger click (empty simulator check) |
| `src/main/modules/modbus/modbus-rtu-client.ts` | Accept optional injected serial port in constructor (for VirtualSerialPort) |
| `package.json` | Add `rp2040js` dependency |

---

## 13. Implementation Order

### Phase 1: Foundation (Week 1)
1. `npm install rp2040js`
2. Add "OpenPLC Simulator" entry to `hals.json`
3. Add `isSimulatorTarget()` to `src/utils/device.ts`
4. Update default device to "OpenPLC Simulator" in constants.ts
5. Create `SimulatorModule` with basic load/run/stop
6. Bundle bootrom binary
7. Add simulator IPC endpoints (load-firmware, stop, is-running)

### Phase 2: Compilation (Week 2)
8. Handle `compiler === 'simulator'` in `compileProgram()` — reuse Arduino CLI compilation for RP2040, skip upload step, return UF2 path
9. Force Modbus RTU defines in generated `defines.h` for simulator
10. Wire up build button callback to load UF2 into emulator on success

### Phase 3: Debugger (Week 3)
11. Create `VirtualSerialPort` (EventEmitter mock adapting rp2040js UART to `serialport` API)
12. Modify `ModbusRtuClient` to accept optional injected serial port (single constructor change)
13. Add `'simulator'` connection type to `handleDebuggerConnect` (creates `ModbusRtuClient` + `VirtualSerialPort`)
14. Wire up debugger button flow for simulator: check if simulator is empty → first-stage compilation → MD5 verification → connect

### Phase 4: UI Polish (Week 4)
15. Update board.tsx to show simulator-specific UI (hide irrelevant fields)
16. Update communication.tsx to show "auto-configured" message
17. Create simulator preview image
18. Testing: full flow (new project → build → debugger → see values)
19. Edge cases: re-compile while running, stop simulator, switch device away from simulator

---

## 14. Open Questions / Decisions

1. **Execution model**: rp2040js's `mcu.execute()` may block. Need to verify whether it runs synchronously to completion or yields. If it blocks, run in a Worker thread or use `mcu.step()` in a `setImmediate` loop.

2. **Firmware output location**: Arduino CLI outputs compiled binaries to a temp directory or the sketch build path. Need to verify the exact `.uf2` output path for the RP2040 platform.

3. **Emulator in main vs renderer**: Plan puts it in main process (where Modbus client runs). Alternative: run in renderer and use IPC for UART bytes. Main process is simpler since the debugger already runs there.

4. **Bootrom licensing**: The RP2040 bootrom is Raspberry Pi proprietary. The rp2040js demo includes a bundled copy. Need to verify redistribution rights or use the open-source bootrom alternative if available.

5. **Execution speed**: The emulated UART never blocks (runs faster than real hardware). This means Modbus RTU frame timing may differ. The 50ms frame-completion timeout in the existing RTU client should still work since it's based on silence gaps, not absolute timing.
