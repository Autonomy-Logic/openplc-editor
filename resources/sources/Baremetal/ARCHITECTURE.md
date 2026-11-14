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
| **`modbus_registers.*`** | The standard **operation** FCs (`0x01`–`0x10`): `get/write_discrete`, `read*`/`write*`, served straight from the process image through `openplc_image_*` — no register bank of its own. Compiled out of debug-only builds. | `MODBUS_ENABLED` | `frame` |
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
   `0x41`-`0x4B`) or it is dropped in silence — the channel is private, and an
   exception would tell a bus scanner the address is live. When the two ids are
   equal, which is the default, the server's branch matches first and this costs
   nothing.
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

The extra buffer costs `MAX_MB_FRAME` bytes (128 on ATmega328P/32U4, 256
elsewhere) and is compiled only where TCP is present, so a board without it
keeps its original footprint. The condition is `MBTCP` rather than
`MBSERIAL && MBTCP` because the always-on debugger assembles through the same
path and was losing frames the same way in a TCP-only Modbus build.

# Modbus master — module architecture

The master polls the project's Modbus remote devices from the constant tables of
`modbus_master_config.h` (record types in `modbus_master_types.h`, both written by
the editor). It is a second stack next to the slave, not part of it: it never
touches `mb_frame`, owns its own request and response buffers, and compiles to
nothing with the skeleton stub (`MB_MASTER_ENABLED 0`), so a project without
remote devices builds the same image as before.

## Layers

Dependencies point inward only: transport → protocol → base.

```
                         Baremetal.ino
       commit before the scan · sample after it · mb_master_task()
                              │
               ┌──────────────▼───────────────┐
               │ modbus_master (facade)       │  run state: idle and closed while
               │ mb_master_task()             │  STOPPED, fresh start on the RUN edge
               └──────────────┬───────────────┘
                    ┌─────────▼──────────┐
 TRANSPORT          │ modbus_master_tcp  │  MBAP framing, one request in flight per
                    │                    │  endpoint, timeout, Reconnect
                    └──┬──────────────┬──┘
                       │              │ bm_net::Connection
 PROTOCOL  ┌───────────▼──────────┐ ┌─▼─────────────────┐
           │ modbus_master (core) │ │ baremetal_net     │  the only file naming a
           │ schedule · split ·   │ │ (network seam)    │  network class
           │ build · validate ·   │ └───────────────────┘
           │ stage · on error     │
           └───────────┬──────────┘
 BASE      modbus_pdu (mb_pdu_response_len) · modbus_types (MAX_MB_FRAME, FC codes)
           modbus_master_config / modbus_master_types · arduino_runtime_glue (image)
```

The facade and the protocol core share `modbus_master.cpp`: the facade calls the
transports, the transports call the core, and the core calls neither.

## Modules

| Module | Responsibility | Build gate | Depends on |
|--------|----------------|------------|------------|
| **`modbus_master.*`** | Facade: `mb_master_task()` follows `runtime_get_plc_state()` (every connection closed while STOPPED, all retry and give-up state cleared on the RUN edge) and services the transports. Core: per-group cycle scheduling, the split of a group larger than one frame (`MB_MASTER_PDU_MAX`, from `MAX_MB_FRAME`: 128 bytes on ATmega328P/168/32U4, 272 elsewhere), request PDUs for FC 1-6, 15 and 16, response validation (function code, byte count, echoed address, value or quantity), staging, error handling (zero or keep) and the once-per-scan commit into the image. | `MB_MASTER_ENABLED` | `modbus_master_tcp`, `modbus_pdu`, `arduino_runtime_glue`, `openplc.h` |
| **`modbus_master_tcp.*`** | Modbus TCP transport: one `bm_net::Connection` per endpoint (devices on one `host:port` share it), MBAP header, transaction id, at most one receive buffer per connection per pass, the response timeout counted from the send, Reconnect. | `MB_MASTER_TCP_ENABLED` | `modbus_master`, `baremetal_net` |
| **`baremetal_net.*`** | Network seam, extended with the outbound `Connection` (see below) and the `BOARD_WIFININA` branch. | `BM_NET_ENABLED` = `OPCUA_ENABLED \|\| S7COMM_ENABLED \|\| MB_MASTER_TCP_ENABLED` | `modbus_config` (board defines) |
| **`modbus_pdu.*`** | `mb_pdu_response_len(fc, quantity)`: the length of the normal response, the inverse of `mb_pdu_request_len()`. | — | `registers`, `debug` |

## Scan integration

`scheduler()` runs `mb_master_commit_inputs()` before `runtime_plc_cycle()`, so
every input value a poll staged reaches the image once per scan;
`mb_master_sample_outputs()` after it, so write groups send the outputs the scan
produced; then `mb_master_task()`. `loop()` also runs `mb_master_task()` between
cycles. `runtime_apply_located_forces()` still runs last in both.
`mapEmptyBuffers()` runs when `MODBUS_ENABLED || S7COMM_ENABLED ||
MB_MASTER_ENABLED`, so a point with no program variable still has storage.

## Invariants

1. **Never block.** A request is sent only when the stack has room for all of it
   (`Connection::send()` returns `BM_SEND_NO_ROOM` otherwise, and the poll fails);
   the wait for its response is bounded by the endpoint timeout from the send; a
   pass reads at most one buffer per connection. At most one connect starts per
   pass, so a pass is held at most one connect timeout.
2. **A frame is accepted whole or not at all.** Transaction id, protocol id 0,
   MBAP length (from `mb_pdu_response_len`), unit id, function code and byte count
   must all match the request; values are written only into the group's own points
   and only after the whole frame is valid. A whole frame of another transaction
   is dropped and the wait goes on; bytes that cannot be a frame are dropped.
3. **A failed poll keeps the connection.** A rejected frame, an exception or a
   timeout is one failed poll: a read group applies its error handling and its
   next poll waits one cycle. Only a connection the stack reports lost (connect,
   send or receive error, peer close) follows Reconnect: off, the endpoint gives up
   until the next RUN edge or a reset; on, it retries after 2 s, then 1.5 times
   longer each attempt, at most 30 s. While an endpoint is not connected its read
   groups follow their error handling and its write groups send nothing.
4. **Constant tables, IPv4 only.** Every endpoint, device, group and point comes
   from the generated tables; there is no name resolution anywhere.

## Outbound connections and the slot reserve

`bm_net::Connection` is the master's slot for one endpoint: `start(ip, port,
timeout_ms)`, `poll()` (`BM_CONN_PENDING`, `BM_CONN_CONNECTED`, `BM_CONN_FAILED`),
`read()`, `send()` and `close()`. How it connects is chosen per adapter branch
(`BM_NET_CONNECT`):

| Mechanism | Targets | Connect |
|---|---|---|
| `BM_NET_CONNECT_LWIP` | ESP32 core (`BOARD_ESP32`, and `BOARD_PORTENTA` Wi-Fi on the esp32 core) | raw lwIP socket with `O_NONBLOCK`; `poll()` follows it, room from `select()` |
| `BM_NET_CONNECT_MBED` | mbed core (`MBETH_MBED_LWIP`, `BOARD_PORTENTA` Wi-Fi) | `TCPSocket` with `set_blocking(false)` |
| `BM_NET_CONNECT_CLIENT` | every other target | the library client, with its connect timeout set to the endpoint timeout (a three-argument `connect`, `setConnectionTimeout` or `setTimeout`, whichever the library has); room from `availableForWrite()`, except on `BOARD_WIFININA`, whose library has no room query (`BM_NET_SEND_UNMETERED`) |

The master has `BM_NET_MASTER_SLOTS` = `MB_MASTER_ENDPOINT_COUNT` slots of its
own, outside the listeners' pool (`BM_NET_MAX_CLIENTS`), so neither the master
nor a listener can take the other's. A failed, timed-out or closed connection
gives its socket back at once; no free socket is a failed connect that follows
Reconnect. Without a TCP master none of this code is compiled.

The `BOARD_WIFININA` branch (with `MBTCP_WIFI`) comes before the generic Wi-Fi
branch and serves outbound and inbound connections alike: the S7 and OPC-UA
listeners on a NINA board take `WiFiNINA.h` too. The Modbus TCP server keeps its
own clients and includes in `modbus_tcp.h`.
