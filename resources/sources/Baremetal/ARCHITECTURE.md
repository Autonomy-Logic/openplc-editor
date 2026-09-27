# Modbus slave — module architecture

The `ModbusSlave` layer is split into 10 cohesive `modbus_*` translation units,
each owning one concern and its own build gate. Dependencies point **inward
only** (transport → protocol → handlers → data), and everything is glued by a
single shared buffer, `mb_frame`.

`Baremetal.ino` is unchanged: it `#include "ModbusSlave.h"` (the umbrella) and
calls `mbtask()` once per scan cycle.

## Layers

```
                         Baremetal.ino
                              │  (#include "ModbusSlave.h"; calls mbtask())
                    ┌─────────▼──────────┐
                    │   ModbusSlave.*    │  umbrella header + mbtask() facade
                    └───┬────────────┬───┘
          ┌─────────────▼──┐      ┌──▼──────────────┐
 TRANSPORT │ modbus_serial  │      │  modbus_tcp     │  own the "wire"
           │ (RTU single/dual)│    │  (Eth/WiFi/ETH) │
          └──────┬──────────┘      └────────┬───────┘
                 │  fill mb_frame,          │
                 │  ask for frame shape,    │
                 └───────────┬──────────────┘
                    ┌────────▼─────────┐
 PROTOCOL           │   modbus_pdu     │  dispatch + per-FC frame shape
                    └───┬──────────┬───┘
          ┌─────────────▼─┐     ┌──▼──────────────┐
 HANDLERS  │ modbus_registers│   │  modbus_debug   │
           │ (store + op FCs)│   │ (0x41-0x48 + …) │
          └──────┬─────────┘     └─────────────────┘
                 │
       ┌─────────▼───────────────────────────────────────────────┐
 BASE  │ modbus_frame (seam) · modbus_crc · modbus_types · modbus_config │
       └─────────────────────────────────────────────────────────┘
```

## Modules

| Module | Responsibility | Build gate | Depends on |
|--------|----------------|------------|------------|
| **`modbus_config.h`** | Build configuration. Pulls in the generated `defines.h` (which has **no include guard**) and derives the composite gates (`MB_SERIAL_ACTIVE`, `DEBUG_*` defaults). The single guarded path through which `defines.h` reaches every TU. | — | `defines.h` |
| **`modbus_types.h`** | Shared contracts: FC / exception enums, `struct MBinfo`, `MAX_MB_FRAME`, `MBAP_SIZE`, `MB_DEBUG_*` status codes, bit helpers. Pure declarations, no storage. | — | `modbus_config` |
| **`modbus_frame.*`** | The **seam**: the global `mb_frame` / `mb_frame_len` buffer, the `modbus` instance (slave id + register banks) and `exceptionResponse()`. Every transport fills it, every handler writes into it. | — | `types` |
| **`modbus_crc.*`** | Modbus RTU CRC-16 (`calcCrc`) + the two lookup tables, defined **once** in the `.cpp` (they used to live in a header → one flash copy per TU). | — (RTU) | `frame` |
| **`modbus_registers.*`** | Register store + the standard **operation** FCs (`0x01`–`0x10`): `init_mbregs`, `get/write_discrete`, `read*`/`write*`. Compiled out of debug-only builds. | `MODBUS_ENABLED` | `frame` |
| **`modbus_debug.*`** | The always-on **debugger** FCs (`0x41`–`0x48`): info / set / get / md5 / status / version / device-id. Growth home for future custom FCs (e.g. the `0x49+` licensing set). | — | `frame`, `arduino_runtime_glue`, `license_gate` |
| **`modbus_pdu.*`** | The **protocol** layer: `process_mbpacket()` dispatches each FC to its handler, and it owns the **per-FC frame shape** — `mb_pdu_request_len()` (RTU length by FC) and `mb_pdu_skips_crc()` (which FCs bypass CRC). Single source of truth for "the set of function codes". | — | `registers`, `debug` |
| **`modbus_serial.*`** | The **RTU** transport (single- and dual-serial). Declared-length framing (robust over USB-CDC), one-byte resync, RS485 tx-enable timing, per-port RX assembly buffers. | `MB_SERIAL_ACTIVE` | `pdu`, `crc`, `frame` |
| **`modbus_tcp.*`** | The **TCP** transport (Ethernet / WiFi / ESP ETH). Brings the network stack up, accepts up to `MAX_SRV_CLIENTS`, services MBAP-framed requests. | `MBTCP` | `pdu`, `frame` |
| **`ModbusSlave.*`** | **Umbrella** header (re-includes every `modbus_*.h`, so `Baremetal.ino` is untouched) + the `mbtask()` facade that fans out to `handle_tcp()` / `handle_serial()`. | — | all |

## Build gates

Which TUs actually compile is driven by `defines.h` (generated per build) and the
composite gates in `modbus_config.h`:

- `MODBUS_ENABLED` — full Modbus operations. A debug-only build compiles
  `modbus_registers.cpp` to an empty TU (the debugger reads IEC variables
  directly through the strucpp debug table, needing no operation buffers).
- `MB_SERIAL_ACTIVE` = `MBSERIAL || DEBUGGER_ENABLED` — the serial transport.
  Always on for baremetal (the debugger is always on).
- `MBTCP` (+ `MBTCP_ETHERNET` / `MBTCP_WIFI`) — the TCP transport.
- `MBSERIAL_ON_SECONDARY` — dual-serial: Modbus RTU on a distinct UART while the
  debugger keeps the default serial (each with its own RX buffer). Otherwise
  single-serial (`MBSERIAL_SHARES_DEBUG_SERIAL`), where RTU/debugger share the
  default serial and `mb_frame` doubles as the RX-assembly buffer.

> **Rule:** any gated TU must see `defines.h`. Because `defines.h` has no include
> guard, it reaches a TU through exactly one guarded path: `modbus_config.h`
> (via `modbus_types.h`). Every `modbus_*` header includes that chain.

## Request lifecycle

**RTU (single-serial):**
1. `mbtask()` → `handle_serial()` → `handle_serial_port(mb_serialport, …, mb_frame, …)`.
2. Drain available bytes into `mb_frame`; **ask `modbus_pdu`** via
   `mb_pdu_request_len()` how many bytes the frame should be (derived per FC).
3. Unless the FC is a debug FC (`mb_pdu_skips_crc()`), validate the CRC with
   `modbus_crc::calcCrc()`.

   Step 2 accepts **two** slave ids on this port: the Modbus server's, and
   `MB_EDITOR_SLAVE` for the editor's own link. A frame that matched only the
   editor's id must carry an editor function code (`mb_pdu_is_editor_fc()`,
   `0x41`-`0x4D`, and `0x4E` in RTOS mode) or it is dropped in silence — the
   channel is private, and an exception would tell a bus scanner the address is
   live. When the two ids are equal, which is the default, the server's branch
   matches first and this costs nothing.
4. `process_mbpacket()` dispatches: operation FC → `modbus_registers`; debug FC →
   `modbus_debug`. The response is built back into `mb_frame`.
5. `handle_serial_port` appends the CRC and writes to the serial port.

**TCP:** same from step 4 onward, but `handle_tcp` reads/writes with an MBAP
header (no CRC) instead of RTU framing.

**Dual-serial:** `handle_serial()` services two ports with dedicated RX buffers
(`mb_rx_dbg` / `mb_rx_rtu`); `mb_frame` is only transient process/TX scratch.

## Invariants

1. **Transports do not know the function-code set.** They ask `modbus_pdu`
   (`mb_pdu_request_len`, `mb_pdu_skips_crc`, `mb_pdu_is_editor_fc`). Adding a
   function code touches only `modbus_debug` (the handler) and `modbus_pdu`
   (dispatch + shape) — never the transports. The three predicates answer
   different questions and are not interchangeable: `mb_pdu_skips_crc` excludes
   `0x4B`, which does carry a CRC, so using it as "is this the editor" would make
   run/stop unreachable on the editor's id.
2. **`mb_frame` is the one seam.** Every transport fills it, calls
   `process_mbpacket()`, and reads the response back out. In the single loop
   the transports time-slice within a scan and there are no data races, but
   persistent partial state in `mb_frame` is a hazard — see the note below. In
   RTOS mode the scan runs on other tasks, and every request is run under the
   locks `plc_rtos_run_pdu()` picks for its function code — see
   [RTOS mode](#rtos-mode).

## Adding a function code (e.g. custom `0x49+`)

1. Add the handler in **`modbus_debug.cpp`** (+ prototype in `modbus_debug.h`).
2. In **`modbus_pdu.cpp`**:
   - add a `case` in `process_mbpacket()` that calls the handler;
   - add the FC's request length to `mb_pdu_request_len()`;
   - if the FC should bypass CRC on RTU, add it to `mb_pdu_skips_crc()`;
   - if it lies past the editor's range, widen `mb_pdu_is_editor_fc()` (both
     branches), or it is dropped on the editor's id.
3. Add the FC constant to the enum in **`modbus_types.h`**.
4. If it touches program variables, the process image or HAL/package code, give
   it a case in `plc_rtos_run_pdu()` (`plc_rtos.cpp`), or RTOS mode runs it
   with no lock at all.

That is the whole surface. `modbus_serial.*` and `modbus_tcp.*` are untouched.

## Serial and TCP in the same build

`mb_frame` is the shared process/TX buffer, and it is NOT an assembly buffer for
any port that has to survive a scan cycle alongside TCP.

The single-serial path used to assemble into `mb_frame` directly. That is only
safe while nothing else writes it between cycles, and TCP does: `mbtask()` runs
`handle_tcp()` first, so an incoming request overwrote a partial serial frame
while `mb_rx_len` still described it. The framing logic resynced a byte at a
time and the in-flight transaction was lost — intermittent, and worst under the
concurrent TCP load a working installation produces.

Every path now has its own RX assembly buffer wherever it can be raced:

| Build | Serial assembly | `mb_frame` |
|---|---|---|
| single-serial, no TCP | `mb_frame` in place | assembly + process + TX |
| single-serial + TCP (`MBTCP`) | `mb_rx_single` | process + TX only |
| dual-serial (`MBSERIAL_ON_SECONDARY`) | `mb_rx_dbg`, `mb_rx_rtu` | process + TX only |

The extra buffer costs `MAX_MB_FRAME` bytes (128 on ATmega328P/32U4, 272
elsewhere) and is compiled only where TCP is present, so a board without it
keeps its original footprint. The condition is `MBTCP` rather than
`MBSERIAL && MBTCP` because the always-on debugger assembles through the same
path and was losing frames the same way in a TCP-only Modbus build.

## RTOS mode

On a board whose Arduino core has an RTOS, the editor builds this runtime in
RTOS mode by default: each IEC task on a thread of its own, the services on
theirs. The task model is Runtime v4's (IEC 61131-3 §6.8.2). What users and
library authors need to know is in `docs/rtos-mode.md`; this section is how it
works inside.

**Switching it on.** The editor writes `rtos_config.h` with `OPENPLC_RTOS 1`
over the skeleton's stub. With the stub (`OPENPLC_RTOS 0`) nothing below is
compiled and the build is the single loop above; `plc_os.cpp` and
`plc_rtos.cpp` are left out of the bundle altogether. The supported cores
(FreeRTOS on the ESP32, arduino-pico, STM32, the Uno R4 and SAMD; Mbed OS;
Zephyr) are listed in `middleware/shared/utils/rtos/support.ts`.

### Tasks

| Task | Runs |
|---|---|
| Dispatcher (`loop()`, or a task of its own; the highest priority) | the base tick: run/stop, HAL input, the located globals, releasing each IEC task when due, HAL output as each finishes, forced values, retain, statistics |
| One worker per IEC task | its programs, under its own scan lock, with its located variables copied in and out of the process image. IEC PRIORITY 0 is the highest. |
| Service A | Modbus RTU/TCP, the debugger, discovery; samples stack margins and the heap once a second |
| Service B (if OPC-UA or S7 is enabled) | OPC-UA, S7 |

On a board with 32 KB of RAM or less (`PLC_OS_SMALL_STACKS`) the two services
share one task (4 KB stack), each IEC task and the dispatcher have a 2 KB
stack, and one lock serves the network, every bus and every serial port.

### Timing

- **Overruns are skipped, never queued.** A task still running when it is due
  again is counted, not released.
- **IEC time is the grid time** of the task's release, so timers keep
  wall-clock time across an overrun.
- **On RUN** every task is due on the first tick, and its grid starts there.
- A worker scans only for a release the dispatcher made, never for a stray
  notification.

### Process image

The slot pointers (`bool_input[]` ...) address cells the runtime owns, not the
variables. Each task copies its own located variables in at the start of a
scan, and out at the end, only what it changed, so a protocol write to an
output the scan left alone survives. Forced values are pinned into the cells
every frame, over the HAL and over protocol writes. Located CONFIGURATION
globals are synced every frame under each global's own lock, which the
dispatcher only tries: a global a task holds that moment syncs on the next
frame. STruC++'s hooks (`strucpp_located_global_index`,
`strucpp_global_try_lock`) give each binding its global's lock. With a STruC++
that has none, a scalar's binding is its `GlobalVar`, and a project with a
located ARRAY global is built with one worker.

### Locks

- **Order:** scan locks (by task index), then a global's lock, then the image
  lock. The dispatcher and the retain restore, which hold the image lock, only
  try a global's lock (the restore waits at most 2 ms). The network and bus
  locks come last, and whoever holds one takes nothing else.
- **The image lock** covers copies, HAL calls and the Modbus register banks.
  Nothing holding it may block on the network.
- **The debugger** writes or forces a task's variable only between that task's
  scans, and a global under the global's own lock, waiting up to 100 ms either
  way; it answers exception `0x06` (busy) when a task does not let go. Reads
  never fail: a stalled task's variables, and a global a task holds for more
  than 2 ms, are read as they stand.
- **Globals** have a lock each (STruC++ `STRUCPP_THREADED`, on in a multi-task
  build). With the lock hooks, a statement that updates a global from itself
  is one locked step, and a call of a global FB instance holds that instance's
  lock for the whole call. On a toolchain without `<mutex>` and
  `thread_local` (every core but the ESP32's), `STRUCPP_PLATFORM_THREADS` has
  the runtime take those locks from `plc_os.cpp` (one for all globals on a small
  board) and each task's IEC time from the glue.
- **The network, bus and serial port locks** (`plc_rtos.h`): `openplc_net_lock`,
  `openplc_i2c_lock`, `openplc_spi_lock`, `openplc_can_lock`, and
  `openplc_serial_lock(port)`, one per serial port, keyed by the port object
  (eight locks, bound on first use; ports past the eighth share the last).
  Recursive, and declared weak for outside code, so a library links with and
  without RTOS mode. A bus lock is held for the driver calls, a serial port's
  for a whole exchange (request and reply). OpenPLC's own serial ports are
  served by service A alone and take no lock. A library that drives a shared
  peripheral from more than one task takes its lock around each driver call.
  The block modules in `modules/` do, and so must a board HAL that drives a
  shared bus (the dispatcher calls the HAL under the image lock only). Where the network chip is on SPI, the SPI lock is the
  network lock.
- **The services and the network lock.** `modbus_config.h` decides whether the
  services need it (`OPLC_NET_LOCKED`; not on lwIP under the ESP32 core or
  arduino-pico, Mbed OS, Zephyr). Service A only tries it at the start of a
  pass, so a PLC task holding the network does not hold up the serial port
  there. `handle_tcp()` lets it go while a request is processed and waits for
  it again to reply, so the serial port can wait behind a PLC task that took it
  in between. OPC-UA and S7 get their clients from `bm_net`, which in RTOS mode
  hands out a `Client` that takes the lock for each socket call.

### Start-up and failure

- **A peripheral is started by the task that uses it.** Serial `begin()` and the
  network run on service A, OPC-UA and S7 on service B, not in `setup()`. Every
  RTOS object is made in `plc_rtos_start()`, at the end of `setup()`.
- **The network comes up before the first scan,** as in `setup()`: the
  dispatcher waits up to 15 s for service A's start-up.
- **A failed start-up** (a task or lock that could not be made) leaves the PLC
  in ERROR with nothing released and the outputs off. The services are created
  first, so the editor can still read that.
- **Memory is checked before the board ever runs it:** a compile-time check on
  the fixed RTOS heaps (Uno R4, SAMD), and the editor's estimate against the
  RAM the link leaves free everywhere else.

### Retain

Packed between the owners' scans (a task stalled in a block is read as it
stands), and on STOP after the last scans.

### Statistics

FC `0x4E` (`plc_rtos_encode_stats`). Read-only, apart from flags bit 0, which
resets the statistics window once the last task has been read. Paged:
`[flags][first task]` in; `[status]`, then `[2][total][first][count]`, the tasks
that fit, the services and the board totals out.

### Adding an RTOS

OS calls go through `plc_os.*` only (`arduino/plc_os.h`, backends in
`Baremetal/plc_os.cpp`, a sketch file so that an RTOS shipped as an Arduino
library is found). A new RTOS is a backend there, its priorities in
`plc_os.h`, and one row in the editor's core table. Where the RTOS is not
running under `setup()` (FreeRTOS from a library), the dispatcher is a task of
its own and `plc_rtos_start()` starts the scheduler.
