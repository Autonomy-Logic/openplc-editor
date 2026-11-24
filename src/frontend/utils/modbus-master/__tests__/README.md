# Modbus master header tests

- `generate-modbus-master-header.test.ts`: the generator, its field validation and the AS-05 abuse scenario.
- `firmware-abi.test.ts`: the skeleton stub `modbus_master_config.h` and the record types in
  `modbus_master_types.h`, read as text from the firmware sources.
- `host-compile.test.ts`: the stub and the generated headers of its fixtures compile with
  `modbus_master_types.h` and a `HardwareSerial` stand-in, through
  `g++ -std=gnu++11 -fsyntax-only`. It needs `g++` on the host, so it is skipped unless
  `MB_MASTER_HOST_COMPILE=1` is set.
- `firmware-master-sources.test.ts`: the master modules ship, name no network class (only `baremetal_net`
  does), never touch `mb_frame`, and no firmware source resolves a host name or carries a pending-work marker.
  No source keeps `BM_NET_SEND_UNMETERED` or calls `checkDataSent()`; `reached`, `put16` and `get16` are
  `static inline` in one SPDX-headed Baremetal header that includes only `<stdint.h>` and that the three master
  units include. Read as text; runs everywhere.
- `firmware-master-gates.test.ts`: the build gates, through the host C preprocessor (`g++ -E`) with every
  Arduino and network library header replaced by an empty stand-in. `baremetal_net.h` opens for a TCP master
  and stays closed for an RTU-only master or the stub; a NINA board takes `WiFiNINA.h`; `Baremetal.ino` calls
  `mb_master_task()` from `scheduler()` and `loop()` before the forces, maps the empty buffers for a master-only
  build, and calls nothing of the master with the stub. On a NINA board `baremetal_net.cpp` calls no
  `checkDataSent()`, `delay()` or `setRetry(true)` and names `ServerDrv`; on a W5x00 board `Connection::close()`
  stops only after a zero connection timeout (or aborts); `modbus_master_tcp.cpp` marks the pass on every close
  path and `mb_master_tcp_service()` reads that mark. On a NINA board with the OPC-UA server and
  `OPCUA_DEBUG_LOG 1` (an `opcua_config.h` override), `NinaServer` declares `available()` and every member
  `opcua_log.cpp` calls on the log server, and `NinaClient` declares `port()` and every member `opcua_log.cpp`
  and the accept log of `baremetal_net.cpp` call on a client; with `OPCUA_DEBUG_LOG 0` the log unit is empty.
  On ESP32 and ESP8266 Wi-Fi, `mbconfig_wifi_supervise()` makes one `WiFi.status()` query, passes `wifi_reconnect_due()`
  `has_address` from `WL_CONNECTED` and `joining` from `STA.connected()` (ESP32) or `STATION_CONNECTING` (ESP8266),
  calls `reconnect()` only in the branch that rule guards, and never waits, begins again or prints;
  `mbconfig_ethernet_iface()` registers every `WiFi.onEvent()` (ESP32, the five station events) or the three
  `onStationMode*` handlers, kept in file-level `WiFiEventHandler`s (ESP8266), before `WiFi.begin()`;
  `WIFI_RECONNECT_AFTER_MS` is gone; `loop()` calls the supervision once, first, and only on those two boards.
  Skipped unless `MB_MASTER_HOST_COMPILE=1` is set.
- `wifi-supervision-rule.test.ts`: the Wi-Fi supervision rule `wifi_reconnect_due()` of `wifi_supervision.h`. As text,
  everywhere: the header has the SPDX line, includes only `<stdint.h>` and `"modbus_master_util.h"` and names no
  `WiFi`, `WL_`, `millis` or `Arduino`. On the host: it copies that header and `modbus_master_util.h` unchanged, builds
  a driver with `g++ -std=gnu++11 -Wall` and checks the cases (never due with an address or while joining, due at
  exactly 60 000 ms of quiet, across the `millis()` wrap) and four timelines on a 10 ms step: a 27 s join, a 5 minute
  DHCP wait and a driver retrying every 5 s never ask; a lost station with a silent driver asks at 60 s, then not again
  for 60 s. The host part is skipped unless `MB_MASTER_HOST_COMPILE=1` is set.
- `firmware-master-tcp-link.test.ts`: the TCP master's network link gate and Reconnect timing on the host. It copies
  the real master sources unchanged next to stand-ins for the network seam (a scripted `bm_net::Connection` and
  `bm_net::link_up()`), the clock, the PLC state, the image and the PDU lengths, builds a driver with
  `g++ -std=gnu++11 -Wall`, once with Reconnect off and once with it on, and plays scenarios S1 to S8 on a 10 ms fake
  pass: no connect while the link is down and at most one link query per pass; a connect that fails while the link is
  down is not counted; the 2 s, x1.5, up to 30 s back-off; a truncated frame or a late answer of an old transaction
  costs failed polls and keeps the connection. Skipped unless `MB_MASTER_HOST_COMPILE=1` is set.
- `firmware-master-rtu-sources.test.ts`: the RTU master and the RS-485 helper ship; the RTU master calls no
  `flush()`, `delayMicroseconds()` or `delay()`, never touches `mb_frame`, `mb_rx_*` or the frame-bound
  `calcCrc()`, and includes `modbus_crc.h`; the server and the master both include `modbus_rs485.h`, which
  includes no upper-layer header and carries every CONTROLLINO RS-485 call and pin, gone from
  `modbus_serial.cpp`. Read as text; runs everywhere.
- `firmware-master-rtu-gates.test.ts`: through `g++ -E` like the gates above, `Baremetal.ino` with an RTU-only
  master runs `mb_master_task()` from `scheduler()` and `loop()` before the forces and maps the empty buffers;
  `modbus_rs485` keeps the CONTROLLINO MAXI and MEGA calls on `Serial3`, the MICRO DE and RE pins on
  `Serial2`, and neither on another board; with an RTU master whose bus has an RS-485 pin, `setup()` sets to 255,
  after `hardwareInit()`, the pin-mask elements equal to each `MB_MASTER_BUSES` pin, and names no
  `MB_MASTER_BUSES` with the stub or a TCP-only master. Skipped unless `MB_MASTER_HOST_COMPILE=1` is set.

Run the host checks locally from the repository root:

```sh
# openplc-editor
MB_MASTER_HOST_COMPILE=1 npx jest --config jest.config.json --no-coverage src/frontend/utils/modbus-master/__tests__/host-compile.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-rtu-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-tcp-link.test.ts src/frontend/utils/modbus-master/__tests__/wifi-supervision-rule.test.ts

# openplc-web
MB_MASTER_HOST_COMPILE=1 npx vitest run --config vitest.config.ts src/frontend/utils/modbus-master/__tests__/host-compile.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-rtu-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-tcp-link.test.ts src/frontend/utils/modbus-master/__tests__/wifi-supervision-rule.test.ts
```
