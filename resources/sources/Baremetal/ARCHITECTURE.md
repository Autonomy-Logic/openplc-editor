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
| **`modbus_debug.*`** | The always-on **debugger** FCs (`0x41`–`0x48`): info / set / get / md5 / status / version / board-id. Growth home for future custom FCs (e.g. the `0x49+` licensing set). | — | `frame`, `arduino_runtime_glue`, `ArduinoUniqueID` |
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
4. `process_mbpacket()` dispatches: operation FC → `modbus_registers`; debug FC →
   `modbus_debug`. The response is built back into `mb_frame`.
5. `handle_serial_port` appends the CRC and writes to the serial port.

**TCP:** same from step 4 onward, but `handle_tcp` reads/writes with an MBAP
header (no CRC) instead of RTU framing.

**Dual-serial:** `handle_serial()` services two ports with dedicated RX buffers
(`mb_rx_dbg` / `mb_rx_rtu`); `mb_frame` is only transient process/TX scratch.

## Invariants

1. **Transports do not know the function-code set.** They ask `modbus_pdu`
   (`mb_pdu_request_len` + `mb_pdu_skips_crc`). Adding a function code touches
   only `modbus_debug` (the handler) and `modbus_pdu` (dispatch + shape) — never
   the transports.
2. **`mb_frame` is the one seam.** Every transport fills it, calls
   `process_mbpacket()`, and reads the response back out. Single-threaded
   cooperative scheduling means the transports time-slice within a scan; there
   are no data races, but persistent partial state in `mb_frame` is a hazard —
   see the note below.

## Adding a function code (e.g. custom `0x49+`)

1. Add the handler in **`modbus_debug.cpp`** (+ prototype in `modbus_debug.h`).
2. In **`modbus_pdu.cpp`**:
   - add a `case` in `process_mbpacket()` that calls the handler;
   - add the FC's request length to `mb_pdu_request_len()`;
   - if the FC should bypass CRC on RTU, add it to `mb_pdu_skips_crc()`.
3. Add the FC constant to the enum in **`modbus_types.h`**.

That is the whole surface. `modbus_serial.*` and `modbus_tcp.*` are untouched.

## Known constraint — single-serial + TCP

`mb_frame` is shared between `handle_tcp()` and the single-serial assembly path.
In **single-serial** builds `mb_frame` doubles as the RX-assembly buffer and
holds a partial RTU/debug frame **across scan cycles**; since `mbtask()` runs
`handle_tcp()` first, an incoming TCP request can clobber that partial frame.
The framing logic resyncs, but the in-flight transaction is lost → intermittent
glitches under concurrent TCP load. Dual-serial + TCP is safe (dedicated RX
buffers; `mb_frame` only transient). The original design assumed a single Modbus
operation transport per board; the editor allowing RTU + TCP together violates
that. Fix is planned separately (dedicated single-serial RX buffer scoped to
`MBSERIAL && MBTCP`).
