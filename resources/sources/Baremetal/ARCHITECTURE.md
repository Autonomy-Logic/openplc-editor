# Modbus slave — module architecture

The `ModbusSlave` layer is split into 11 cohesive `modbus_*` translation units,
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
       ┌─────────▼─────────────────────────────────────────────────────────────┐
 BASE  │ modbus_frame (seam) · modbus_crc · modbus_rs485 · modbus_types · modbus_config │
       └───────────────────────────────────────────────────────────────────────┘
```

## Modules

| Module | Responsibility | Build gate | Depends on |
|--------|----------------|------------|------------|
| **`modbus_config.h`** | Build configuration. Pulls in the generated `defines.h` (which has **no include guard**) and derives the composite gates (`MB_SERIAL_ACTIVE`, `DEBUG_*` defaults). The single guarded path through which `defines.h` reaches every TU. | — | `defines.h` |
| **`modbus_types.h`** | Shared contracts: FC / exception enums, `struct MBinfo`, `MAX_MB_FRAME`, `MBAP_SIZE`, `MB_DEBUG_*` status codes, bit helpers. Pure declarations, no storage. | — | `modbus_config` |
| **`modbus_frame.*`** | The **seam**: the global `mb_frame` / `mb_frame_len` buffer, the `modbus` instance (slave id + register banks) and `exceptionResponse()`. Every transport fills it, every handler writes into it. | — | `types` |
| **`modbus_crc.*`** | Modbus RTU CRC-16 + the two lookup tables, defined **once** in the `.cpp` (they used to live in a header → one flash copy per TU). `calcCrc()` reads `mb_frame`; `mb_crc16(data, len)` takes any buffer and is the master's. | — (RTU) | `frame` |
| **`modbus_rs485.*`** | RS-485 direction control shared by the RTU server and the master: the generic driver-enable pin (`mb_rs485_init`, `mb_rs485_pin`) and every CONTROLLINO transceiver branch (`mb_rs485_board`: MAXI and MEGA through `Controllino_RS485*` on `Serial3`, MICRO through its DE and RE pins on `Serial2`). It switches the line and never waits; the caller decides when. | — | `config` |
| **`modbus_registers.*`** | The standard **operation** FCs (`0x01`–`0x10`): `get/write_discrete`, `read*`/`write*`, served straight from the process image through `openplc_image_*` — no register bank of its own. Compiled out of debug-only builds. | `MODBUS_ENABLED` | `frame` |
| **`modbus_debug.*`** | The always-on **debugger** FCs (`0x41`–`0x48`): info / set / get / md5 / status / version / device-id. Growth home for future custom FCs (e.g. the `0x49+` licensing set). | — | `frame`, `arduino_runtime_glue`, `license_gate` |
| **`modbus_pdu.*`** | The **protocol** layer: `process_mbpacket()` dispatches each FC to its handler, and it owns the **per-FC frame shape** — `mb_pdu_request_len()` (RTU length by FC) and `mb_pdu_skips_crc()` (which FCs bypass CRC). Single source of truth for "the set of function codes". | — | `registers`, `debug` |
| **`modbus_serial.*`** | The **RTU** transport (single- and dual-serial). Declared-length framing (robust over USB-CDC), one-byte resync, RS485 tx-enable timing (the T3.5 waits around the blocking send; the switching itself goes through `modbus_rs485`), per-port RX assembly buffers. | `MB_SERIAL_ACTIVE` | `pdu`, `crc`, `rs485`, `frame` |
| **`modbus_tcp.*`** | The **TCP** transport (Ethernet / WiFi / ESP ETH). Brings the network stack up, accepts up to `MAX_SRV_CLIENTS`, services MBAP-framed requests. On ESP32 Wi-Fi it turns modem sleep off (`WiFi.setSleep(false)` right after `WiFi.begin()`): the radio stays in receive between beacons, so frames to the board are not lost while it sleeps, at the cost of the active-receive current all the time instead of the modem-sleep average (not measured), for every ESP32 Wi-Fi project. | `MBTCP` (link bring-up: `OPLC_NET_ENABLED`) | `pdu`, `frame` |
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
5. `handle_serial_port` appends the CRC and writes to the serial port: the
   enable pin goes high and T3.5 passes, the board's transceiver switches to
   transmit, the frame is written and flushed, T3.5 passes, then the pin and the
   transceiver return to receive (all through `modbus_rs485`).

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

The master polls the project's Modbus remote devices, over TCP and over RTU on the
board's secondary UARTs, from the constant tables of
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
            ┌─────────────────┴─────────────────┐
  ┌─────────▼──────────┐              ┌─────────▼──────────┐
  │ modbus_master_tcp  │ TRANSPORT    │ modbus_master_rtu  │  RTU framing, one request
  │ MBAP, one request  │              │                    │  in flight per bus, idle
  │ per endpoint,      │              │                    │  line, non-blocking send,
  │ timeout, Reconnect │              │                    │  timeout
  └──┬──────────────┬──┘              └──┬──────────────┬──┘
     │              │ bm_net::Connection │              │ HardwareSerial (the bus's UART)
     │   ┌──────────▼────────┐           │   ┌──────────▼────────────────┐
     │   │ baremetal_net     │           │   │ modbus_rs485 · modbus_crc │
     │   │ (network seam)    │           │   │ (mb_crc16)                │
     │   └───────────────────┘           │   └───────────────────────────┘
     └──────────────┬────────────────────┘
 PROTOCOL  ┌────────▼─────────────┐
           │ modbus_master (core) │  schedule · split · build · validate · stage · on error
           └───────────┬──────────┘
 BASE      modbus_pdu (mb_pdu_response_len) · modbus_types (MAX_MB_FRAME, FC codes)
           modbus_master_config / modbus_master_types · arduino_runtime_glue (image)
```

The facade and the protocol core share `modbus_master.cpp`: the facade calls the
transports, the transports call the core, and the core calls neither.

## Modules

| Module | Responsibility | Build gate | Depends on |
|--------|----------------|------------|------------|
| **`modbus_master.*`** | Facade: `mb_master_task()` follows `runtime_get_plc_state()` (every connection closed while STOPPED, all retry and give-up state cleared on the RUN edge) and services the transports. Core: per-group cycle scheduling, the split of a group larger than one frame (`MB_MASTER_PDU_MAX`, from `MAX_MB_FRAME`: 128 bytes on ATmega328P/168/32U4, 272 elsewhere), request PDUs for FC 1-6, 15 and 16, response validation (function code, byte count, echoed address, value or quantity), staging, error handling (zero or keep) and the once-per-scan commit into the image. | `MB_MASTER_ENABLED` | `modbus_master_tcp`, `modbus_master_rtu`, `modbus_pdu`, `arduino_runtime_glue`, `openplc.h` |
| **`modbus_master_tcp.*`** | Modbus TCP transport: one `bm_net::Connection` per endpoint (devices on one `host:port` share it), MBAP header, transaction id, at most one receive buffer per connection per pass, the response timeout counted from the send, Reconnect. | `MB_MASTER_TCP_ENABLED` | `modbus_master`, `modbus_master_util`, `baremetal_net` |
| **`modbus_master_rtu.*`** | Modbus RTU transport: one state machine per bus (devices on one UART share it): idle, pending (waits for an idle line), send, await. Slave id and CRC around the core's PDU, the bus timeout (the smallest of its devices) counted from the end of the request, at most one receive buffer per bus per pass. See "RTU buses" below. | `MB_MASTER_RTU_ENABLED` | `modbus_master`, `modbus_master_util`, `modbus_crc`, `modbus_rs485` |
| **`modbus_rs485.*`** | The RS-485 helper of the slave's base layer, shared with the RTU server. | — | `modbus_config` |
| **`modbus_crc.*`** | `mb_crc16(data, len)`: CRC-16 over the master's own buffers, never `mb_frame`. | — | `frame` |
| **`modbus_master_util.h`** | Internal helpers of the three master units, `static inline`: `reached(now, when)` (wrap-safe deadline test), `put16` and `get16` (big-endian 16-bit values). | — | `<stdint.h>` only |
| **`baremetal_net.*`** | Network seam, extended with the outbound `Connection` (see below) and the `BOARD_WIFININA` branch with its own `NinaClient` and `NinaServer` over the WiFiNINA module driver. | `BM_NET_ENABLED` = `OPCUA_ENABLED \|\| S7COMM_ENABLED \|\| MB_MASTER_TCP_ENABLED` | `modbus_config` (board defines) |
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
   on `BOARD_WIFININA` the module's answer to the send command is the meter: a
   send is one module exchange with no retry and no data-sent poll, and a send the
   module takes none of is `BM_SEND_NO_ROOM`, never retried in the pass. The wait
   for its response is bounded by the endpoint timeout from the send; a pass reads
   at most one buffer per connection. At most one connect starts per pass, and
   none in a pass in which any endpoint's connection was closed, so a pass is held
   at most one connect timeout. Closes do not wait (see "Closing a connection"),
   except on the branches listed there, which close at most one connection per
   pass when the PLC stops.
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
   longer each attempt, at most 30 s. Connects wait for the network link: a pass
   that has a connect to follow or one due asks `bm_net::link_up()` at most once,
   and while it answers down no connect starts and the due endpoint keeps its
   Reconnect timing. A connect that fails while the link is down is not counted as
   an attempt: its connection is closed and the endpoint connects in the first pass
   that finds the link up, whatever its Reconnect. A lost established connection
   follows Reconnect whatever the link answer. While an endpoint is not connected
   its read groups follow their error handling and its write groups send nothing.
4. **Constant tables, IPv4 only.** Every endpoint, device, group and point comes
   from the generated tables; there is no name resolution anywhere.
5. **The slave's state is not the master's.** The RTU master never names
   `mb_frame`, `mb_frame_len` or the server's receive buffers, and computes its CRC
   with `mb_crc16()` over its own frames. A bus on the debugger's or the Modbus RTU
   server's UART is refused at build and, should one reach the firmware, never
   polls.

## Outbound connections and the slot reserve

`bm_net::Connection` is the master's slot for one endpoint: `start(ip, port,
timeout_ms)`, `poll()` (`BM_CONN_PENDING`, `BM_CONN_CONNECTED`, `BM_CONN_FAILED`),
`read()`, `send()` and `close()`. How it connects is chosen per adapter branch
(`BM_NET_CONNECT`):

| Mechanism | Targets | Connect |
|---|---|---|
| `BM_NET_CONNECT_LWIP` | ESP32 core (`BOARD_ESP32`, and `BOARD_PORTENTA` Wi-Fi on the esp32 core) | raw lwIP socket with `O_NONBLOCK`; `poll()` follows it, room from `select()` |
| `BM_NET_CONNECT_MBED` | mbed core (`MBETH_MBED_LWIP`, `BOARD_PORTENTA` Wi-Fi) | `TCPSocket` with `set_blocking(false)` |
| `BM_NET_CONNECT_CLIENT` | every other target | the library client, with its connect timeout set to the endpoint timeout (a three-argument `connect`, `setConnectionTimeout` or `setTimeout`, whichever the library has); room from `availableForWrite()`, except on `BOARD_WIFININA`, where `NinaClient::write()` is one `ServerDrv::sendData()` exchange and the module's count is the answer (all of it: sent; none: `BM_SEND_NO_ROOM`; part: lost) |

`bm_net::link_up()` tells the master whether the board's network interface is
up and addressed. It never waits: it reads the driver's state or makes at most one
status query of the module, and resolves no name. The master names no network
class or link state itself.

| Adapter branch | `link_up()` is true when |
|---|---|
| `BOARD_ESP32` with `MBTCP_WIFI`, `BOARD_ESP8266`, `BOARD_WIFININA` with `MBTCP_WIFI`, `BOARD_PICOW` and `BOARD_PORTENTA` with `MBTCP_WIFI`, the generic `MBTCP_WIFI` branch | `WiFi.status() == WL_CONNECTED` (on the ESP32 and ESP8266 cores this status means joined and addressed; on NINA it is one module status exchange, no send) |
| `BOARD_ESP32` with `MBTCP_ETHERNET` | `ETH.linkUp()` and a non-zero `ETH.localIP()` (`<ETH.h>` is included in `baremetal_net.cpp` for this build only) |
| `MBETH_SPI` with the WIZnet `Ethernet.h` (W5100, W5200, W5500) | `Ethernet.linkStatus() != LinkOFF` (a W5100 answers `Unknown`, which counts as up) |
| `MBETH_SPI` with `MBTCP_ETH_ENC28J60`, `MBETH_MBED_LWIP`, `BOARD_LOGO8` | always (no link query is relied on there) |

The master has `BM_NET_MASTER_SLOTS` = `MB_MASTER_ENDPOINT_COUNT` slots of its
own, outside the listeners' pool (`BM_NET_MAX_CLIENTS`), so neither the master
nor a listener can take the other's. A failed, timed-out or closed connection
gives its socket back at once; no free socket is a failed connect that follows
Reconnect. Without a TCP master none of this code is compiled.

The `BOARD_WIFININA` branch (with `MBTCP_WIFI`) comes before the generic Wi-Fi
branch and serves outbound and inbound connections alike: the S7 and OPC-UA
listeners on a NINA board take `WiFiNINA.h` too. `WiFiClient::write()` of
WiFiNINA 2.1.1 always ends in `ServerDrv::checkDataSent()`, which polls the
module with `delay(100)` up to 25 times, and with retry off it closes the socket
when the module refuses the data; `WiFiClient::stop()` waits up to 5 s for the
close. So on NINA the seam never uses `WiFiClient`: `NinaClient` and `NinaServer`
handle the module's sockets through `ServerDrv` (socket, start client, start and
accept server, send, state, stop) and `WiFiSocketBuffer` (available, read). A send
is one `sendData()` exchange and the module's answer says how much it took; the
module firmware's data-sent query is a no-op that always answers yes, so there is
no separate confirmation to ask for. `can_send()` answers true for a listener's
client (up to 65535 bytes), and a write the module refuses returns 0 without
closing the socket. `stop()` sends the module's stop and frees the receive buffer
without waiting; the module frees the socket in that exchange and hands out only
free sockets. Two members are used by the OPC-UA debug log only
(`OPCUA_DEBUG_LOG`): `NinaServer::available()`, which mirrors WiFiNINA 2.1.1
`WiFiServer::available()` (the last socket it returned while that client is
connected and has data, else `ServerDrv::availServer()` without accepting), and
`NinaClient::port()`, the peer's port from `WiFiDrv::getRemoteData()`. The
listeners and the TCP master use `accept()`. Only `baremetal_net` names these classes. The Modbus TCP server keeps
its own clients and includes in `modbus_tcp.h`.

### Closing a connection

`Connection::close()` makes no library call on a connection that is already
closed, and on the library-client path releases the socket without the library's
graceful wait, through the first form the library has:

| Form | Libraries | Wait |
|---|---|---|
| `stop(1)` | ESP8266 core, Pico W (`stop()` and the ESP8266 `abort()` wait up to 300 ms for the peer's acknowledgements) | at most 1 ms |
| `setConnectionTimeout(0)`, then `stop()` | Ethernet 2.0.2 (W5x00 AVR, P1AM; one status check, at most `delay(1)`, then `socketClose()`), EthernetENC and STM32Ethernet (their `stop()` does not wait), `NinaClient`, WiFiS3 | none, except WiFiS3 below |
| `stop()` | Energia lwIP (LOGO!): `stop()` does not wait | none |

The close after a failed connect and after a lost link is this same close. In a
master pass in which any endpoint's connection was closed no connect starts; the
due endpoint connects on a later pass.

Branches whose library has no close that skips its wait set
`BM_NET_CLOSE_WAITS`: `BOARD_PORTENTA` with `MBTCP_WIFI` on the Renesas core (Uno
R4 WiFi, WiFiS3: `stop()` is one modem command, bounded by the library's
`MODEM_TIMEOUT` of 10 s) and the generic `MBTCP_WIFI` branch (its library is not
identified, so it is treated the same way). On those, the STOP edge closes one
connection and each following pass closes the next, so a pass holds at most one
such close; no request is sent while STOPPED. A RUN edge before they are all
closed closes the rest one per pass before the endpoint connects again.

## RTU buses

`modbus_master_rtu` drives each bus of `MB_MASTER_BUSES` through its own state
machine, one request in flight at a time:

| State | What a pass does | Leaves for |
|---|---|---|
| idle | reads and discards what the line holds (at most one buffer), then takes the next request due on the bus from the core | pending, with the slave id and CRC around the PDU |
| pending | keeps discarding; sends once the line has been silent for 3.5 characters (1750 µs above 19200 bd), counted from the last byte seen and from the end of the master's own last request | send; or one failed poll when the line stays busy for the bus timeout |
| send | hands the UART what it takes without waiting, the RS-485 line on transmit from before the first byte | await, on the first pass after the request has left, with the RS-485 line back on receive |
| await | takes at most one buffer and checks every byte as it arrives: slave id, function code, byte count for the reads, then the CRC of the whole frame. A byte that cannot belong to the normal response (an exception frame included) or a byte past its end is one failed poll; so is the bus timeout. A whole valid frame is handed to the core (`mb_master_accept()`, which checks it again and stages its values) once the line has been silent for 3.5 characters, so a longer frame is rejected | idle |

After a failed poll the bytes still arriving are discarded by the next idle and
pending passes, so the next request starts only after the line has been idle.
A failed poll keeps the bus as it is; RTU has no Reconnect.

**Echoed request bytes.** A slave answers only after 3.5 characters of silence,
so bytes that arrive while the request is on the line, and until 3.5 characters
after its estimated end (less 1/32 of the frame for clock error), cannot be the
response. The send passes, and the await passes still inside that window, read and
discard them (at most one buffer per pass) instead of reading them as the
response. With a transceiver whose receiver stays on while transmitting, every
function code reads and writes correctly as long as the master's pass after the
request comes within the window; a later pass cannot tell the echo from a response
and the poll may fail, the same limit as the RS-485 release. Without an echo
nothing is discarded that could be a response.

**RS-485 enable pins and the pin masks.** In `setup()`, after `hardwareInit()`,
every pin mask element (`pinMask_DIN`, `pinMask_AIN`, `pinMask_DOUT`,
`pinMask_AOUT`) equal to a bus's `rs485_pin` is set to 255, as for
`MBSERIAL_TXPIN`, so the program's I/O never drives the master's transceiver.
Only with `MB_MASTER_RTU_ENABLED`; the stub and a TCP-only master leave the masks
as they are.

**UART mechanisms.** On the first RUN edge each bus's UART is begun with its baud
rate and line setting (`SERIAL_8E1` and the like, 7 or 8 data bits, parity N, E or
O, 1 or 2 stop bits) and its RS-485 control prepared (`mb_rs485_init`). The core's
`HardwareSerial` is used as the table gives it, except on the Due, whose
`HardwareSerial` takes no line setting and reports no transmit room: there the
`USARTClass` objects `Serial1` to `Serial3` are used. A line setting the core does
not define (7 data bits without parity on the STM32F1, for example) leaves the bus
off: it never polls and its read groups follow their error handling. A UART that
belongs to the debugger or to the Modbus RTU server is left off the same way.

**Sending without waiting.** A pass writes only what `availableForWrite()` reports,
so the request is handed over across passes when it is longer than the UART's
transmit buffer. There is no `flush()` and no delay: the request has left when the
time its characters need at the bus's baud rate has passed (start, data, parity
and stop bits each), plus one character and 1/32 of the frame for clock error, and
the RS-485 line returns to receive on the first pass after that. A UART that
reports no room before the first byte of a request has no transmit buffer to
report (the mbed cores, Opta and Nano RP2040 Connect among them, and the Renesas
core): it takes the whole request in one `write()`, which returns once the last
character is in the UART, so the pass is held for about the request's transmit
time (8 bytes for a read: 4.2 ms at 19200 bd, 0.7 ms at 115200 bd).
