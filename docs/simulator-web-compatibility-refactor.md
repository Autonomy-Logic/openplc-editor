# Refactor Editor Simulator for Web Compatibility

Refactor the `openplc-editor`'s simulator files to use only universal JavaScript APIs, enabling zero-modification copy to `openplc-web`.

## Summary

| Category | Count | Details |
|----------|-------|---------|
| Become web-compatible | 4 files | Simulator core, virtual serial port, Modbus RTU client, enums |
| Updated (stay Node.js) | 2 files | IPC handler absorbs file I/O and real serial port creation |
| Node.js APIs removed | 6 | Buffer, EventEmitter, fs, process.nextTick, SerialPort, NodeJS.Timeout |

## Motivation

Today, porting the simulator from editor to web requires ~30 individual adaptations across 3 files. Every future bug fix or feature must be applied twice. After this refactoring, the simulator files are **identical** in both projects.

| Today (Node.js-specific) | After (universal JS) |
|--------------------------|----------------------|
| `Buffer.alloc()`, `.writeUInt16BE()`, etc. | `new Uint8Array()`, helper functions |
| `extends EventEmitter` | Manual callback arrays |
| `import { readFile } from 'fs/promises'` | Caller passes hex content as string |
| `process.nextTick(cb)` | `queueMicrotask(cb)` |
| `import { SerialPort } from 'serialport'` | `SerialPortLike` interface (duck typing) |
| `NodeJS.Timeout` type | `ReturnType<typeof setTimeout>` |

> All replacements work in both Node.js >= 11 and modern browsers. No polyfills needed.

## Implementation Order

1. `modbus-types.ts` — Extract enums
2. `modbus-client.ts` — Import + re-export enums
3. `virtual-serial-port.ts` — Drop EventEmitter, Buffer, process.nextTick
4. `modbus-rtu-client.ts` — Drop Buffer, SerialPort; add SerialPortLike interface
5. `simulator-module.ts` — Drop fs; accept hex string
6. `ipc/main.ts` — Absorb file reading, SerialPort creation, bootloader delay

## Detailed Changes

### 1. `modbus-types.ts` — New file

**Path:** `src/main/modules/modbus/modbus-types.ts`

Extract `ModbusFunctionCode` and `ModbusDebugResponse` enums from `modbus-client.ts`. The RTU client currently imports these from `modbus-client.ts`, which also contains `ModbusTcpClient` (uses Node.js `net.Socket`). Extracting the enums breaks that dependency chain.

```typescript
export enum ModbusFunctionCode {
  DEBUG_INFO     = 0x41,
  DEBUG_SET      = 0x42,
  DEBUG_GET      = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5  = 0x45,
}

export enum ModbusDebugResponse {
  SUCCESS             = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
}
```

**Impact:** Pure type extraction. Zero runtime change. `modbus-client.ts` re-exports for backward compat.

### 2. `simulator-module.ts` — 2 changes

**Path:** `src/main/modules/simulator/simulator-module.ts`

| What | Before | After |
|------|--------|-------|
| Import | `import { readFile } from 'fs/promises'` | *removed* |
| Method | `async loadAndRun(hexPath: string): Promise<void>` | `loadAndRun(hexContent: string): void` |
| File reading | `const hexData = await readFile(hexPath, 'utf-8')` | Uses `hexContent` parameter directly |

The IPC handler reads the file and passes content to `loadAndRun(hexContent)`.

**Impact:** Minimal. The module becomes a pure computation unit. All emulation logic unchanged. `setTimeout` and `performance.now()` already work in both environments.

### 3. `virtual-serial-port.ts` — Rewrite internals, same interface

**Path:** `src/main/modules/simulator/virtual-serial-port.ts`

| What | Before | After |
|------|--------|-------|
| Base class | `extends EventEmitter` (from 'events') | Manual arrays: `dataListeners[]`, `openListeners[]`, `errorListeners[]` |
| Event emission | `this.emit('data', Buffer.from([byte]))` | `this.dataListeners.forEach(cb => cb(new Uint8Array([byte])))` |
| Async scheduling | `process.nextTick(() => this.emit('open'))` | `queueMicrotask(() => { ... })` |
| `write()` param | `Uint8Array \| Buffer` | `Uint8Array` |
| New methods | — | `on()`, `once()`, `removeListener()`, `removeAllListeners()` |

**Impact:** Behavioral parity. Same bytes, same callbacks, same order. File grows from 47 to ~85 lines.

### 4. `modbus-rtu-client.ts` — Most extensive changes

**Path:** `src/main/modules/modbus/modbus-rtu-client.ts`

#### Removed (Node.js-specific)

| What | Current code | Where it goes |
|------|-------------|---------------|
| SerialPort import | `import { SerialPort } from 'serialport'` | Moved to `ipc/main.ts` |
| `port`, `baudRate` fields | `private port: string; private baudRate: number` | Removed — caller creates the port |
| `ARDUINO_BOOTLOADER_DELAY_MS` | `const = 2500` | Moved to `ipc/main.ts` |
| Real SerialPort branch | `new SerialPort({...})` in `connect()` | Moved to `ipc/main.ts` |

#### Added: `SerialPortLike` interface

Both `VirtualSerialPort` (simulator) and real `SerialPort` (npm) satisfy this via duck typing:

```typescript
export interface SerialPortLike {
  isOpen: boolean
  open(): void
  close(): void
  write(data: Uint8Array, callback?: (err?: Error | null) => void): void
  flush(callback?: (err?: Error | null) => void): void
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
  removeAllListeners(event?: string): void
}
```

#### Buffer → Uint8Array migration

| Buffer API (removed) | Uint8Array helper (added) |
|----------------------|--------------------------|
| `Buffer.alloc(n)` | `allocBytes(n)` → `new Uint8Array(n)` |
| `Buffer.concat([a, b])` | `concatBytes(a, b)` → `Uint8Array.set()` |
| `buf.writeUInt8(val, off)` | `writeUint8(buf, off, val)` |
| `buf.writeUInt16BE(val, off)` | `writeUint16BE(buf, off, val)` |
| `buf.readUInt8(off)` | `readUint8(buf, off)` |
| `buf.readUInt16BE(off)` | `readUint16BE(buf, off)` |
| `buf.readUInt32BE(off)` | `readUint32BE(buf, off)` |
| `data.copy(target, offset)` | `target.set(data, offset)` |
| `response.toString('utf-8')` | `new TextDecoder().decode(bytes)` |
| `NodeJS.Timeout` | `ReturnType<typeof setTimeout>` |

#### Simplified constructor

```typescript
// serialPort is now required and strongly typed
interface ModbusRtuClientOptions {
  slaveId: number
  timeout: number
  serialPort: SerialPortLike
}
```

#### Simplified `connect()`

Only the injected port path remains:

```typescript
async connect(): Promise<void> {
  this.serialPort = this.injectedSerialPort
  return new Promise((resolve, reject) => {
    this.serialPort!.on('open', () => resolve())
    this.serialPort!.on('error', (err) => reject(...))
    this.serialPort!.open()
  })
}
```

#### Return type changes

| Method | Before | After |
|--------|--------|-------|
| `getVariablesList()` | `data?: Buffer` | `data?: Uint8Array` |
| `setVariable()` | `valueBuffer?: Buffer` | `valueBuffer?: Uint8Array` |

> **Downstream impact:** Code calling `getVariablesList()` that expects `Buffer` must switch to `Uint8Array`. In the editor, this is only the IPC handler. Since `Buffer` extends `Uint8Array` in Node.js, most read operations work identically.

**Protocol unchanged:** CRC tables, frame assembly, response parsing, mutex serialization, retry logic, timeouts — all identical.

### 5. `modbus-client.ts` — Minor update

**Path:** `src/main/modules/modbus/modbus-client.ts`

Remove enum definitions, import and re-export from `modbus-types.ts`:

```typescript
// Before: enums defined inline
// After:
export { ModbusFunctionCode, ModbusDebugResponse } from './modbus-types'
```

**Impact:** Zero. All existing imports continue to work.

### 6. `ipc/main.ts` — Absorbs Node.js-specific logic

**Path:** `src/main/modules/ipc/main.ts`

#### a) `handleSimulatorLoadFirmware`

```typescript
// Before:
await this.simulatorModule.loadAndRun(hexPath)

// After:
const hexContent = await readFile(hexPath, 'utf-8')
this.simulatorModule.loadAndRun(hexContent)
```

#### b) 3 simulator ModbusRtuClient creation sites

Remove `port` and `baudRate` from options (fields no longer exist):

```typescript
const virtualPort = new VirtualSerialPort(this.simulatorModule)
client = new ModbusRtuClient({
  // removed: port: 'simulator',
  // removed: baudRate: 115200,
  slaveId: 1,
  timeout: 5000,
  serialPort: virtualPort,
})
```

#### c) 3 real RTU ModbusRtuClient creation sites

Move SerialPort creation and bootloader delay from client to handler:

```typescript
const ARDUINO_BOOTLOADER_DELAY_MS = 2500

const realPort = new SerialPort({
  path: connectionParams.port,
  baudRate: connectionParams.baudRate,
  autoOpen: false,
  dataBits: 8, stopBits: 1, parity: 'none',
})
client = new ModbusRtuClient({
  slaveId: connectionParams.slaveId,
  timeout: 5000,
  serialPort: realPort,
})
await client.connect()
await new Promise(resolve => setTimeout(resolve, ARDUINO_BOOTLOADER_DELAY_MS))
```

> **6 call sites** must be updated: 3 simulator (remove `port`/`baudRate`) + 3 RTU (externalize SerialPort).

## Impact Analysis

### Benefits

- 4 simulator files become copy-paste portable between editor and web
- Bug fixes and features only need to be written once
- Stronger typing: `SerialPortLike` replaces `any`
- Better separation of concerns: I/O moved to callers
- No new dependencies; `Uint8Array` is a built-in
- `serialport` npm package no longer imported in shared code

### Trade-offs

- 6 call sites in `main.ts` must be updated (mechanical changes)
- Virtual serial port grows from 47 to ~85 lines (EventEmitter reimplementation)
- `Uint8Array` helpers add ~30 lines to `modbus-rtu-client.ts`
- Future code using `getVariablesList` gets `Uint8Array` instead of `Buffer`
- Real RTU bootloader delay logic moves to 3 places in `main.ts`

## What's NOT Affected

| Component | Status |
|-----------|--------|
| ModbusTcpClient (`modbus-client.ts`) | Unchanged — still uses Node.js `net.Socket` |
| WebSocketDebugClient | Unchanged — still uses `Buffer` |
| Renderer / React components | Unchanged — call via `window.bridge.*` IPC |
| Compiler module | Unchanged — still produces HEX files |
| avr8js dependency | Unchanged — pinned at 0.20.0, already browser-compatible |
| Preload / bridge API | Unchanged — `simulatorLoadFirmware(hexPath)` still accepts a path |

## Outcome

After this refactoring, these files are **byte-identical** between `openplc-editor` and `openplc-web`:

- `simulator-module.ts`
- `virtual-serial-port.ts`
- `modbus-rtu-client.ts`
- `modbus-types.ts`

The web-only files (`simulator-service.ts`, `SimulatorManager` component) remain separate — they replace the Electron IPC bridge and are specific to the web architecture.

**Future maintenance:** Any bug fix or feature added to these 4 files in either project can be copied directly to the other with no translation step.
