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
  "Simulator": {
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

Change the default device board from `'OpenPLC Runtime v3'` to `'Simulator'`:

```typescript
defaultDeviceConfiguration: DeviceConfiguration = {
  deviceBoard: 'Simulator',  // was 'OpenPLC Runtime v3'
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

### 5a. Compiler Module Changes

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

The `compileForDebugger()` method (line 2102) also needs the simulator branch. It follows the same pattern: compile for RP2040, then signal the renderer with the UF2 path instead of trying to upload.

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

## 7. Modbus RTU Bridge for Simulator

### 7a. Virtual Serial Bridge

**File:** `src/main/modules/simulator/simulator-modbus-bridge.ts` (NEW)

This bridges the existing Modbus RTU protocol logic with the emulated UART. It replaces the physical serial port with virtual byte-level callbacks.

The existing `ModbusRtuClient` (`src/main/modules/modbus/modbus-rtu-client.ts`) is tightly coupled to the `serialport` npm package. Rather than refactoring it, create a **SimulatorModbusClient** that implements the same public interface (`connect`, `disconnect`, `getMd5Hash`, `getVariablesList`, `setVariable`) but routes bytes through the emulated UART instead of a serial port.

```typescript
class SimulatorModbusClient {
  private simulator: SimulatorModule
  private rxBuffer: number[] = []
  private responseResolve: ((data: Buffer) => void) | null = null
  private frameTimeout: NodeJS.Timeout | null = null

  constructor(simulator: SimulatorModule) {
    this.simulator = simulator
    // Receive bytes from emulated RP2040's UART TX
    this.simulator.onUartByte = (byte) => this.handleReceivedByte(byte)
  }

  async connect(): Promise<void> {
    // No physical port to open. Just wait for firmware to boot.
    // The RP2040 firmware has a ~2.5s bootloader delay, but in emulation
    // the UART is ready almost immediately. Add a small delay for safety.
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  disconnect(): void {
    this.simulator.onUartByte = null
  }

  async getMd5Hash(): Promise<string> {
    // Build Modbus RTU request frame for FC 0x45 (DEBUG_GET_MD5)
    // Same protocol as ModbusRtuClient but using virtual UART
    const request = this.buildRequest(0x01, 0x45, Buffer.alloc(0))
    const response = await this.sendAndReceive(request)
    return this.parseMd5Response(response)
  }

  async getVariablesList(indices: number[]): Promise<{...}> {
    // Same protocol as ModbusRtuClient.getVariablesList
    // Build FC 0x44 request, send via virtual UART, parse response
  }

  async setVariable(index: number, force: boolean, value?: Buffer): Promise<{...}> {
    // Same protocol as ModbusRtuClient.setVariable
    // Build FC 0x42 request, send via virtual UART, parse response
  }

  private sendAndReceive(frame: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.rxBuffer = []
      this.responseResolve = resolve

      // Send each byte to the emulated UART RX
      for (const byte of frame) {
        this.simulator.feedByte(byte)
      }

      // Timeout for response
      setTimeout(() => {
        if (this.responseResolve) {
          this.responseResolve = null
          reject(new Error('Simulator Modbus response timeout'))
        }
      }, 5000)
    })
  }

  private handleReceivedByte(byte: number): void {
    this.rxBuffer.push(byte)

    // Reset frame completion timeout (50ms gap = end of frame)
    if (this.frameTimeout) clearTimeout(this.frameTimeout)
    this.frameTimeout = setTimeout(() => {
      if (this.responseResolve && this.rxBuffer.length > 0) {
        this.responseResolve(Buffer.from(this.rxBuffer))
        this.responseResolve = null
        this.rxBuffer = []
      }
    }, 50)
  }

  // CRC16, frame building — reuse from existing modbus-rtu-client.ts
  // Extract shared CRC16/frame utilities into a common module
}
```

### 7b. Shared Modbus RTU Utilities

**File:** `src/main/modules/modbus/modbus-rtu-utils.ts` (NEW)

Extract from `modbus-rtu-client.ts`:
- `calculateCRC16(buffer)` — CRC lookup table and calculation (lines 27-59)
- `buildRtuFrame(slaveId, functionCode, data)` — frame assembly with CRC
- `ModbusFunctionCode` enum
- Response parsing helpers

Both `ModbusRtuClient` (physical serial) and `SimulatorModbusClient` (virtual UART) will import from this shared module.

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

New branch:
```typescript
case 'simulator':
  // Create SimulatorModbusClient connected to the running emulator
  this.debuggerModbusClient = new SimulatorModbusClient(this.simulatorModule)
  await this.debuggerModbusClient.connect()
  break
```

The `SimulatorModbusClient` implements the same interface as `ModbusRtuClient`, so all existing debug polling logic (`handleDebuggerGetVariablesList`, `handleDebuggerVerifyMd5`, `handleDebuggerSetVariable`) works unchanged.

### 8b. Debugger Button — Simulator Flow

**File:** `src/renderer/components/_organisms/workspace-activity-bar/default.tsx`

The `handleDebuggerClick` function (line 377) currently:
1. Checks if runtime target → requires IP/connection
2. Checks if arduino target → requires Modbus RTU or TCP enabled
3. Runs debug compilation
4. On success, connects debugger with the appropriate connection type

For the simulator, the flow should be:
1. Detect `isSimulatorTarget` → skip all connection checks (no IP, no port, no Modbus config)
2. Run debug compilation (same `runDebugCompilation` call with `boardTarget = 'Simulator'`)
3. The compilation callback receives `simulatorFirmwarePath` — load into emulator
4. Wait for emulator to boot (~500ms)
5. Call `debuggerConnect('simulator', {})` — connects to the already-running emulator's UART
6. Proceed with MD5 verification and variable polling (all existing code)

```typescript
if (isSimulatorTarget(currentBoardInfo)) {
  connectionType = 'simulator'
  // No IP, port, or Modbus config needed
  // Compilation will produce UF2 and auto-load into emulator
}
```

The debug compilation callback:
```typescript
if (data.simulatorFirmwarePath) {
  // Load firmware into simulator
  await window.bridge.simulatorLoadFirmware(data.simulatorFirmwarePath)
  // Small delay for firmware boot
  await new Promise(resolve => setTimeout(resolve, 500))
}

if (data.closePort) {
  // Proceed with MD5 verification as usual
  void handleMd5Verification(projectPath, boardTarget, 'simulator', {}, undefined, false)
}
```

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
| `src/main/modules/simulator/simulator-modbus-bridge.ts` | Modbus RTU client over virtual UART |
| `src/main/modules/simulator/bootrom.ts` | Bundled RP2040 bootrom binary |
| `src/main/modules/modbus/modbus-rtu-utils.ts` | Shared CRC16/frame utilities extracted from modbus-rtu-client |
| `resources/sources/boards/images/simulator.png` | Device preview image |

### Modified Files

| File | Changes |
|------|---------|
| `resources/sources/boards/hals.json` | Add "Simulator" entry at top |
| `src/utils/device.ts` | Add `isSimulatorTarget()` function |
| `src/renderer/store/slices/device/data/constants.ts` | Change default device to "Simulator" |
| `src/renderer/components/_features/[workspace]/editor/device/configuration/board.tsx` | Hide comm port, pin mapping, IP address, Connect button for simulator |
| `src/renderer/components/_features/[workspace]/editor/device/configuration/communication.tsx` | Hide Modbus RTU/TCP config for simulator |
| `src/main/modules/compiler/compiler-module.ts` | Handle `compiler === 'simulator'` in compileProgram/compileForDebugger; force Modbus RTU defines |
| `src/main/modules/ipc/main.ts` | Add simulator IPC handlers; add `'simulator'` connection type to debugger |
| `src/main/modules/ipc/renderer.ts` | Add renderer wrappers for simulator IPC |
| `src/main/modules/preload/preload.ts` | Expose simulator bridge methods |
| `src/renderer/components/_organisms/workspace-activity-bar/default.tsx` | Handle simulator in build callback and debugger click |
| `src/main/modules/modbus/modbus-rtu-client.ts` | Extract CRC16/frame utils to shared module, import from there |
| `package.json` | Add `rp2040js` dependency |

---

## 13. Implementation Order

### Phase 1: Foundation (Week 1)
1. `npm install rp2040js`
2. Add "Simulator" entry to `hals.json`
3. Add `isSimulatorTarget()` to `src/utils/device.ts`
4. Update default device in constants.ts
5. Create `SimulatorModule` with basic load/run/stop
6. Bundle bootrom binary
7. Add simulator IPC endpoints (load-firmware, stop, is-running)

### Phase 2: Compilation (Week 2)
8. Handle `compiler === 'simulator'` in `compileProgram()` — reuse Arduino CLI compilation for RP2040, skip upload step, return UF2 path
9. Handle `compiler === 'simulator'` in `compileForDebugger()` — same pattern
10. Force Modbus RTU defines in generated `defines.h` for simulator
11. Wire up build button callback to load UF2 into emulator on success

### Phase 3: Debugger (Week 3)
12. Extract shared Modbus RTU utils (CRC16, frame building) to `modbus-rtu-utils.ts`
13. Implement `SimulatorModbusClient` using virtual UART bridge
14. Add `'simulator'` connection type to `handleDebuggerConnect`
15. Wire up debugger button flow for simulator (auto-compile, auto-load, auto-connect)

### Phase 4: UI Polish (Week 4)
16. Update board.tsx to show simulator-specific UI (hide irrelevant fields)
17. Update communication.tsx to show "auto-configured" message
18. Create simulator preview image
19. Testing: full flow (new project → build → debugger → see values)
20. Edge cases: re-compile while running, stop simulator, switch device away from simulator

---

## 14. Open Questions / Decisions

1. **Execution model**: rp2040js's `mcu.execute()` may block. Need to verify whether it runs synchronously to completion or yields. If it blocks, run in a Worker thread or use `mcu.step()` in a `setImmediate` loop.

2. **Firmware output location**: Arduino CLI outputs compiled binaries to a temp directory or the sketch build path. Need to verify the exact `.uf2` output path for the RP2040 platform.

3. **Emulator in main vs renderer**: Plan puts it in main process (where Modbus client runs). Alternative: run in renderer and use IPC for UART bytes. Main process is simpler since the debugger already runs there.

4. **Bootrom licensing**: The RP2040 bootrom is Raspberry Pi proprietary. The rp2040js demo includes a bundled copy. Need to verify redistribution rights or use the open-source bootrom alternative if available.

5. **Execution speed**: The emulated UART never blocks (runs faster than real hardware). This means Modbus RTU frame timing may differ. The 50ms frame-completion timeout in the existing RTU client should still work since it's based on silence gaps, not absolute timing.
