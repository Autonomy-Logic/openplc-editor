# Modbus TCP and RTU master on baremetal: compile and bench checks

The baremetal firmware has no host test harness, so the Modbus TCP and RTU master is proven here: by compiling real
projects on real toolchains, by comparing images, and by running bench projects against the scripted hostile
slave (`scripts/bench/modbus-hostile-slave/`). The preprocessor gates and the source rules have their own Jest
tests in `src/frontend/utils/modbus-master/__tests__/` (see the README there).

Every check below names its project, the observation that passes it, and what the firmware without the master
shows instead (the negative control: build the same project from the branch before the master landed, where
the firmware ignores `modbus_master_config.h`). The RTU checks are in "RTU master" at the end; their negative
control is the TCP master's firmware, which compiles the RTU buses out.

## Contents

| Path | What it is |
| --- | --- |
| `projects/compile-*` | Compile fixtures, literal low addresses so a 2 KB AVR has room for the image |
| `projects/tc*`, `projects/as*` | Bench projects, one per check or per shared configuration (table below) |
| `maps/*.json` | Register maps for the hostile slave's `normal` scenario (`--map`) |
| `compare-images.ts` | Compares two builds of one project, target by target |

Every project toggles `scan_toggle` (`%QX0.0`) once per scan, with a 20 ms task. Where the board has default
pins, `%QX0.0` is mapped to a digital output in `devices/pin-mapping.json` (ESP32 `02`, Uno and Nano 33 IoT
and Mkr WiFi `7`, Mega `23`, Nano RP2040 Connect `8`, ESP8266 `D1`); the logic analyzer watches that pin. The
LOGO!, Opta and P1AM-200 have no default pins: map `%QX0.0` to an output on the board's own screen before
measuring.

Program variables are bound to the points by alias (`MB_G1_0`, ...), so they follow the points if the editor
reallocates their addresses; read them by name in the debugger. In the scenarios, `%IW100` to `%IW109` is
`g1_0` to `g1_9`, `%IW110` to `%IW119` is `g2_0` to `g2_9`, and so on.

## Open prerequisites

- Signed RTOP-410 packages: pending. The compile checks and the bench need the packages that declare
  `modbusTcpMaster`, signed (the editor refuses an unsigned package); production packages without the
  capability make the build refuse TCP. Install them into the editor or into a `--user-data` folder with
  `--install`.
- AS-09 W5500 rows: the board is pending (it needs a W5500 and the S7 server; the Uno and the Mega declare no
  S7 server). Its project is added with the board.
- RTU RS-485 pins: the per-UART pin (`rs485_en_pins`) and the FX3U's fixed `PA14` exist only in the RTOP-410
  packages, which declare `minEditorVersion` 4.4.0, and the package manager refuses a package that needs a
  newer editor. Until the signed packages land, run the checks that need them with a local package build that
  accepts the running editor, never committed; they stay pending with the signed packages.

## Common setup

- Network: the bench host running the hostile slave is `192.168.1.50`, the board is `192.168.1.20/24`,
  gateway `192.168.1.1`. AS-13 also uses `192.168.1.60` on the bench host. Change both sides together if the bench LAN differs.
- Work on a copy: `cp -r scripts/bench/modbus-master/projects /tmp/mm-projects`. The editor rewrites a project
  on save, and the Wi-Fi SSID and password (placeholders `OPENPLC-BENCH` / `set-on-the-bench`) are entered on
  the board's Network screen of the copy only; they never go into the repository.
- Hostile slave: `scripts/bench/modbus-hostile-slave/README.md` is its reference (setup of the bench host
  address, options, log events, OS settings). Commands here take the form `npm run bench:hostile-slave --
  --scenario <name> [--row <n>] [--map <file>] --tcp-listen 192.168.1.50:502 --log <check>.jsonl`.
- Poll groups: the slave recognizes FC 3 reads at G1 = offset 0, G2 = offset 10, G3 = offset 20, and its
  scripted answers have fixed sizes: G1 10 registers, G2 1 (2 in AS-03), G3 1, and 4321, 8765 (2 registers)
  after AS-07's flood and AS-10's stall. The projects use those offsets and sizes, so no `--groups` is needed;
  `--groups g1=<addr>,g2=<addr>,g3=<addr>` only moves the start addresses.
- Capture: `tcpdump -i <interface> -w <check>.pcap host 192.168.1.20` on the bench host for every check.
  "The connection stays open" means the next request arrives on the same client port with no FIN, RST or new
  SYN in between.
- Scan time: the logic analyzer on the toggle pin; one scan is the time between two edges. Measure the
  baseline with no attack first. Without a connect, pass is baseline + 2 ms (AS-06, AS-07, AS-10); with a
  connect, cycle time + device timeout (TC06, AS-13: 20 + 500 ms).
- "Does not reset or hang": the toggle keeps toggling and the debugger stays connected.
- Evidence per check: steps, expected and actual result, the capture or the slave's log, the debugger
  reading, and for scan time the analyzer trace.

## Compile checks

Copy the projects first; `compile:matrix` writes each build under `<project>/build/<target>/`. Pass the same
`--user-data` to every command, and `--out` outside the repository.

### (a) The TCP master compiles on every network family

```sh
npm run compile:matrix -- /tmp/mm-projects/compile-tcp-master --user-data <dir> --clean \
  --board "Arduino Uno" --board "Arduino Mega" --board "ESP32 Generic" --board "ESP8266 NodeMCU" \
  --board "Arduino Opta" --board "Arduino Giga" --board "Nano 33 IoT" --board "Mkr WiFi" \
  --board "Nano RP2040 Connect" --board "Raspberry Pico W" --board "Arduino Uno R4 WiFi" \
  --board "Siemens LOGO! 8.3" --board "AutomationDirect P1AM-200" --board "NUCLEO STM32-F446ZET" \
  --out /tmp/mm-a.jsonl
npm run compile:matrix -- /tmp/mm-projects/compile-tcp-master-wifi --user-data <dir> --clean --no-build \
  --board "Arduino Opta" --board "Raspberry Pico W" --board "Arduino Uno R4 WiFi" --out /tmp/mm-a-wifi.jsonl
```

`compile-tcp-master` leaves the carrier to the board: Wi-Fi-only boards build Wi-Fi, the others Ethernet.
`compile-tcp-master-wifi` forces Wi-Fi on the dual-carrier boards (mbed Wi-Fi, CYW43, WiFiS3). Both projects
have every FC, two devices on one `host:port` and a second endpoint with Reconnect off.

Pass: every board compiles. A board that does not fit is reported with the compiler's message from the JSONL
log (RSK04); any other failure fails the phase. Run without `--board` filters for the full sweep of the
official boards.

### (b) No remote devices, same image as `development`

Build `compile-no-remote-devices` (no network) and `compile-no-remote-devices-net` (network and the Modbus TCP
server) on Uno, Mega, ESP32 Generic and Opta, and `compile-no-remote-devices-s7` (S7 server, through
`baremetal_net`) on ESP32 Generic and Opta, from both trees, each on its own copy:

```sh
# this branch
mkdir -p /tmp/mm/branch && cp -r scripts/bench/modbus-master/projects/compile-no-remote-devices* /tmp/mm/branch/
npm run compile:matrix -- /tmp/mm/branch/compile-no-remote-devices --user-data <dir> --clean \
  --board "Arduino Uno" --board "Arduino Mega" --board "ESP32 Generic" --board "Arduino Opta" --out /tmp/mm/b1.jsonl
# ... the same for compile-no-remote-devices-net, and compile-no-remote-devices-s7 on ESP32 Generic and Opta

# development, in its own worktree with its own install
git worktree add /tmp/mm/development-tree origin/development
mkdir -p /tmp/mm/development && cp -r scripts/bench/modbus-master/projects/compile-no-remote-devices* /tmp/mm/development/
cd /tmp/mm/development-tree && npm ci && npm run setup:strucpp
npm run compile:matrix -- /tmp/mm/development/compile-no-remote-devices --user-data <dir> --clean \
  --board "Arduino Uno" --board "Arduino Mega" --board "ESP32 Generic" --board "Arduino Opta" --out /tmp/mm/d1.jsonl
# ... the same for the other two projects

# compare, from this repository
for p in compile-no-remote-devices compile-no-remote-devices-net compile-no-remote-devices-s7; do
  TS_NODE_TRANSPILE_ONLY=true npx ts-node scripts/bench/modbus-master/compare-images.ts \
    /tmp/mm/development/$p/build /tmp/mm/branch/$p/build
done
```

Pass: `compare-images.ts` prints `SAME` for every target and exits 0: identical `.hex` or `.bin`, or, where
the toolchain embeds build data, identical allocated section sizes and the same defined symbols, compared on
normalised names (GCC and LTO clone suffixes `.constprop.<n>`, `.part.<n>`, `.isra.<n>`, `.lto_priv.<n>` and
`.cold` removed, and the `.o.<n>` tail of a `_GLOBAL__` name), so an identical image whose clones were
renumbered compares `SAME`.

### (c) The web Simulator build keeps the master out

In openplc-web (local-dev-toolkit or staging), with the board `OpenPLC Simulator`, build the TC01 project and
the same project with its remote device deleted. Pass: both builds succeed and run in the Simulator; the
remote-device build shows the Simulator's "remote devices are ignored" warning; in the browser's network tab,
the `/compile-arduino` request of both builds carries `src/modbus_master_config.h` with
`#define MB_MASTER_ENABLED 0`.

### (g) A NINA OPC-UA build with the debug log compiles

| Check | Project | Board | Command | Status |
| --- | --- | --- | --- | --- |
| OPC-UA project for the Nano RP2040 Connect built with `OPCUA_DEBUG_LOG=1` compiles | `tc17-nano-rp2040-connect-s7-opcua` | Nano RP2040 Connect (`arduino:mbed_nano:nanorp2040connect`) | see below | pending, with the compile matrix and the signed RTOP-410 packages |

```sh
npm run compile:matrix -- /tmp/mm-projects/tc17-nano-rp2040-connect-s7-opcua --user-data <dir> --clean \
  --board "Nano RP2040 Connect" --out /tmp/mm-g.jsonl
B=$(echo /tmp/mm-projects/tc17-nano-rp2040-connect-s7-opcua/build/*/)
resources/bin/<platform>/<arch>/arduino-cli compile --clean --config-file <dir>/User/arduino-cli.yaml \
  --fqbn arduino:mbed_nano:nanorp2040connect \
  --build-property "compiler.c.extra_flags=-MMD -c -Wno-incompatible-pointer-types" \
  --build-property "compiler.cpp.extra_flags=-DOPCUA_DEBUG_LOG=1" \
  --library "$B/src" "$B/examples/Baremetal/Baremetal.ino"
```

The matrix run writes the project's sources with `OPCUA_ENABLED 1`; the second command compiles them again with
the debug log on (`opcua_log.cpp` calls `available()` on `NinaServer` and `port()` on `NinaClient`). Pass: the
compile exits 0.

## Bench checks

| Check | Project | Board | Runs |
| --- | --- | --- | --- |
| TC01, AC01 every FC | `tc01-every-fc` | ESP32 Wi-Fi | now |
| TC02 shared connection | `tc02-shared-endpoint` | ESP32 Wi-Fi | now |
| TC03, TC04, TC07 Reconnect off | `tc03-tc04-tc07-reconnect-off` | ESP32 Wi-Fi | now |
| TC05 Reconnect on | `tc05-tc06-reconnect-on` | ESP32 Wi-Fi | now |
| TC06 scan bound | `tc05-tc06-reconnect-on` | ESP32 Wi-Fi | logic analyzer |
| TC06 other paths | `tc06-logo`, `tc06-opta-wifi`, `tc06-opta-ethernet`, `tc06-p1am-200-ethernet`, `tc06-esp8266`, `tc06-nano-33-iot`, `tc06-nano-rp2040-connect` | as named | hardware |
| TC10, AS-02 | `as02-sentinel` | ESP32 Wi-Fi | now |
| AS-01 | `as01-uno-w5x00` | Uno + W5x00 | hardware |
| TC11 | `tc11-uno-125-registers` | Uno + W5x00 | hardware |
| AS-03 | `as03-late-response` | ESP32 Wi-Fi | now |
| AS-04 row 1 | `as04-row1-esp32-server` | ESP32 Wi-Fi | now |
| AS-04 row 2 | `as04-row2-mega-w5500` | Mega + W5500 | hardware |
| AS-06, AS-07, AS-10 | `as06-as07-as10-slow-slave` | ESP32 Wi-Fi | capture now, scan time with the analyzer |
| AS-08 | `as08-s7-flood` | ESP32 Wi-Fi | now |
| AS-09 ESP32 rows | `as09-esp32` | ESP32 Wi-Fi | now |
| AS-09 W5500 rows | placeholder, added with the board | W5500 + S7 (pending) | hardware |
| AS-13 | `as13-w5100-reconnect-on`, `as13-w5100-reconnect-off` | Uno + W5100 | hardware |
| TC17, AC07 | `tc17-nano-33-iot-s7`, `tc17-nano-rp2040-connect-s7-opcua`, `tc17-mkr-wifi-s7` | as named | hardware |
| NINA send metering (AS-10, TC17 widened) | `as06-as07-as10-slow-slave` on a NINA board, the `tc17-*` projects | Nano 33 IoT, Mkr WiFi, Nano RP2040 Connect | pending: NINA boards, analyzer |
| Closes that do not wait (TC06, NFR01) | added with the board: two endpoints, Reconnect checked, timeout 500 ms | W5500, then a TC17 NINA board | pending: W5500, NINA, analyzer |

The ESP32 projects name `ESP32 Generic`, the bench ESP32's package entry.

Negative control for every check: the same project built from the branch before the master landed shows no
request from `192.168.1.20` in the capture or the slave's log.

### TC01: every FC, both directions (AC01)

1. Slave: `--scenario normal --map scripts/bench/modbus-master/maps/tc01.json`. Upload `tc01-every-fc`, start
   the PLC, open the debugger.
2. Expect: `fc1_0..2` = TRUE, FALSE, TRUE; `fc2_0..1` = FALSE, TRUE; `fc3_0` = 1234 and `fc3_3` = 4321 (the
   program declares only these two of the four FC 3 points: the master still fills the other two, V7);
   `fc4_0..1` = 42, 7.
3. Writes: `step` increases every second. The slave's log shows FC 5 to offset 20, FC 6 to offset 20, FC 15 to
   offsets 30 to 32 and FC 16 to offsets 30 to 31 with the program's values; within one poll, `back5_0` =
   `fc5_0`, `back6_0` = `fc6_0`, `back15_*` = `fc15_*`, `back16_*` = `fc16_*` (written, then read back).
4. The board does not reset (toggle and debugger) for 10 minutes.

### TC02: two devices on one `host:port`

Slave `normal --map maps/g1-1234-5678.json` (its `normal` answers echo the request's unit id). Expect in the
capture one TCP connection from the board carrying requests with unit id 1 and unit id 2, and in the slave's
log one `accepted` event; `a_0`, `a_1` and `b_0`, `b_1` = 1234, 5678.

### TC03, TC04, TC07: Reconnect off (AC03)

Groups: `zero` (offset 0, set-to-zero) and `keep` (offset 10, keep-last-value). Slave map `maps/reconnect.json`.

- TC03: slave stopped (host up, port 502 closed). Power the board. Expect one SYN to `192.168.1.50:502`
  within 500 ms of the network coming up, then none for 5 minutes; `zero_*` and `keep_*` read 0.
- TC07: then Stop and Start the PLC from the editor, with the slave running. Expect one new connect, and
  `zero_*` = 1111, 2222, `keep_*` = 3333, 4444.
- TC04: then stop the slave (it closes the connection). Expect no SYN for 5 minutes, `zero_*` = 0,
  `keep_*` = 3333, 4444, and the scan unaffected. Pulling the cable instead gives only failed polls until the
  stack reports the socket lost; the give-up follows that report.

### TC05 and TC06: Reconnect on

Same groups and map. TC05: with the PLC running and polling, stop the slave, wait 60 s, start it again.
Expect SYNs at about 2, 3, 4.5, 6.75 s and so on after the loss, the interval capped at 30 s, and polling
back with `zero_*` = 1111, 2222 within one interval of the slave's return. TC06: with the slave stopped,
the worst scan stays within 20 + 500 ms over 10 minutes (analyzer). The `tc06-*` projects repeat TC06 on the
other seven paths.

### TC10 and AS-02: rejected TCP responses

`as02-sentinel`: G1 offset 0, 10 registers, 100 ms; sentinel G2 offset 10, 1 register, 60 s. For each row
1 to 9: slave `--scenario AS-02 --row <n>`. After the baseline (G1 = 101..110, G2 = 23130), expect `g1_*` = 0
(never the 201.. values a malformed frame carries), `g2_0` still 23130 (read before G2's next poll), the next
request on the same client port, and then `g1_*` = 501..510. TC10 rows: excess bytes (1, 2), wrong
transaction id (6), wrong FC (9); bad CRC has no TCP row.

### AS-01 (Uno with W5x00, 128-byte frame) and TC11

`as01-uno-w5x00`: as AS-02, with `--scenario AS-01`. Expect `g1_*` = 0, `g2_0` = 23130, no reset, the
connection kept, then `g1_*` = 501..510. TC11, `tc11-uno-125-registers`: slave `normal --map maps/tc11.json`;
expect `big_0` = 1000, `big_1` = 1001, `big_60..62` = 1060..1062, `big_123` = 1123, `big_124` = 1124, and the
capture showing the group split into several FC 3 requests that cover offsets 0 to 124.

### AS-03: a late response is not applied to a later request

`as03-late-response` (G1 10 registers, G2 2, sentinel G3 1 register at 60 s), slave `--scenario AS-03`.
Expect `g2_0`, `g2_1` = 3333, 4444; `g1_*` = 0 until G1's own answer; `g3_0` still 23130.

### AS-04: other traffic never reaches the master's pending response

Row 1, `as04-row1-esp32-server`: slave `--scenario AS-04 --row 1 --board 192.168.1.20`. After 50 rounds
expect `bad_steps` (`%QW10`) = 0, `g1_0` equal to the last `counter` of the slave's `poll` events, every
`response` of the client role = 7000..7009 with its own transaction id, and each client read inside a 200 ms
wait of the master in the capture. Row 2, `as04-row2-mega-w5500`: `--scenario AS-04 --row 2 --tcp-listen
192.168.1.50:502 --client-serial <board UART> --client-baud 115200 --debug-index <arr:elem of held_0..held_9
from the build's STruC++ debug map>`, the debugger function code 0x44 being the other source; same oracles.

### AS-06, AS-07, AS-10: a slow, flooding or stalled slave

`as06-as07-as10-slow-slave`: G1 offset 0, 2 registers (the size of the slave's 4321, 8765 answer), 100 ms,
timeout 500 ms. The slave's AS-06, AS-07 and AS-10 start on the first request, so first run `normal --map
maps/g1-1234-5678.json` until `g1_0`, `g1_1` = 1234, 5678, then stop it and start the scenario on the same
address (Reconnect is on). The restart already zeroes G1, so in these checks "reads 0" is not the
discriminating oracle: the request spacing, the scan time and the values after the attack are.

- AS-06 (`--scenario AS-06`, 5 minutes): consecutive G1 requests at most 650 ms apart; `g1_*` = 0; worst scan
  within baseline + 2 ms.
- AS-07 (`--scenario AS-07`): worst scan within baseline + 2 ms during the 60 s flood; `g1_*` = 0 during it;
  no reset; then `g1_*` = 4321, 8765.
- AS-10 (`--scenario AS-10`, 15 minutes, with the receive buffer shrunk in the OS as the slave's README says,
  and restored after): the capture shows the slave's zero window (`tcp.analysis.zero_window`) and when it
  starts; worst scan within baseline + 2 ms; `g1_*` = 0; the debugger stays connected; after the slave reads
  again and answers 4321, 8765, `g1_*` reads them.

### AS-08: filling the S7 listener does not take the master's connection

`as08-s7-flood` (S7 for 2 clients, DB1 = `%QW0`..`%QW9`, the program writes 4242 to `%QW0`; device Reconnect
off). Start `--scenario AS-08 --board 192.168.1.20 --tcp-listen 192.168.1.50:502` (the attacker holds every S7
connection it gets, and a `normal` slave answers the master), then power the board. Expect the master's first
connect to `192.168.1.50:502` completing in the capture, an S7 read of DB1.DBW0 = 4242 on each
accepted connection, and the rest refused.

### AS-09: failed connects leak no slot or socket

`as09-esp32` (S7 for 2 clients, the Modbus TCP server, device Reconnect on, timeout 500 ms). Slave
`--scenario AS-09 --row 1` (no listener: the OS resets every SYN) and `--row 2` (SYNs dropped by the firewall
rule of the slave's README), each for 10 minutes, then type `accept` and Enter (row 2: remove the rule first).
Expect at least 20 (row 1) and 18 (row 2) connect attempts, then 2 S7 clients accepted at once, the editor
debugger connected over the board's Modbus TCP server, and once `192.168.1.50` accepts again the master
connected within 30.5 s.

### AS-13: exhausting the WIZnet sockets

`as13-w5100-reconnect-on` and `-off` (Uno + W5100, the Modbus TCP server on 502, device at
`192.168.1.60:502`, timeout 500 ms). With `192.168.1.60` added to the bench host, start `--scenario AS-13
--board 192.168.1.20 --tcp-listen 192.168.1.60:502` before power-on: the attacker fills port 502 until the
board stops answering SYN, logs `saturated` and releases 60 s later (`released`), and a `normal` slave
answers the master at `192.168.1.60`. Expect the worst scan within 520 ms, no reset; with Reconnect on, the master connected to
`192.168.1.60:502` within 30.5 s of the release; with Reconnect off, no connect attempt to `192.168.1.60`
until Stop then Start, after which it connects. The Uno is the W5100 board; a build that does not fit is
reported with the compiler's message (RSK04).

### TC17: the NINA boards run the master and their servers (AC07)

`tc17-nano-33-iot-s7`, `tc17-mkr-wifi-s7`, `tc17-nano-rp2040-connect-s7-opcua`: slave `normal --map
maps/g1-1234-5678.json`. Expect `g1_0`, `g1_1` = 1234, 5678, an S7 read of DB1.DBW0 = 4242, and on the Nano
RP2040 Connect an OPC-UA client connecting to `opc.tcp://192.168.1.20:4840/openplc/opcua` and reading the
server status.

### NINA send metering: AS-10 on a NINA board, and TC17 widened

Board: Nano 33 IoT. Build `as06-as07-as10-slow-slave` for it, with `%QX0.0` on its default pin 7, and run the
AS-10 row of "AS-06, AS-07, AS-10" against it. Expect the worst scan within the no-attack baseline + 2 ms (a send
never waits for the module: without the metering, `WiFiClient::write()` polls the module up to 25 times 100 ms,
about 2.5 s per scan). Then run TC17 on the Nano 33 IoT (S7), the Mkr WiFi (S7) and the Nano RP2040 Connect (S7
and OPC-UA): every server still answers. Status: pending, NINA boards and the analyzer.

### Closes that do not wait (TC06, NFR01)

Board: an AVR with a W5500 shield; the project, added with the board, has two endpoints (`A` and `B`), Reconnect
checked, timeout 500 ms. Slave A closes the connection and drops the board's final FIN/ACK exchange while host B
drops every SYN. Expect the worst scan within cycle time + 500 ms (a close never waits; at most one connect, the
endpoint timeout, per pass, and no connect in a pass that closed a connection). Then press Stop with every
endpoint hostile: the debugger answers within one cycle after the Stop. Repeat the close on a TC17 NINA board.
Status: pending, W5500, NINA board and the analyzer.

## RTU master

The RTU master polls Modbus RTU devices on the board's secondary UARTs through the same master core, one
request in flight per bus, and drives each UART's RS-485 enable pin without blocking the scan. The Modbus RTU
server shares the RS-485 helper (`Baremetal/modbus_rs485.*`) and must keep its behaviour.

### RTU setup

- Board: Arduino Mega. The debugger and the upload stay on the USB port (`Serial`); the slave is on `Serial1`
  through a USB-TTL adapter at the Mega's 5 V logic (or through a level shifter): adapter TX to pin 19 (RX1),
  adapter RX to pin 18 (TX1), common ground. AS-04 row 3 adds a W5500 shield and a second adapter on `Serial2`:
  TX to pin 17 (RX2), RX to pin 16 (TX2).
- Line: the projects use 19200 bd, 8 data bits, no parity, 1 stop bit, slave id 1, timeout 500 ms, except
  `as07-rtu-115200` (115200 bd) and `br10-br12-rtu-bus-timeout` (timeouts 200 and 500 ms).
- Hostile slave: `npm run bench:hostile-slave -- --scenario <name> [--row <n>] --serial <adapter> --baud
  <the device's baud> [--map <file>] --log <check>.jsonl`. It answers unit 1 only and logs the frames of other
  unit ids as `ignored`. Its `request`, `rx`, `tx`, `discarded`, `withheld` and `phase` events, with `t_us`, are
  the line evidence.
- Logic analyzer: pin 23 (scan toggle), pin 18 (TX1), pin 19 (RX1), and pin 22 (the RS-485 enable pin of
  `Serial1`) in TC08. Scan time pass rule as in "Common setup": baseline + 2 ms.
- Groups: the slave's fixed offsets and sizes (G1 10 registers at 0, G2 1 at 10, 2 in AS-12, G3 1 at 20). The
  sentinel group is the first group of its device, so the master reads it before the attack; each check says
  how to confirm that order in the slave's log.
- Negative control for every RTU bench check: the same project built from the TCP master's firmware (the branch
  at the phase 08 tests commit) puts no byte on TX1: the slave's log has no `rx` event and the points stay 0.

### (d) The RTU master compiles, with and without an RS-485 pin

```sh
npm run compile:matrix -- /tmp/mm-projects/compile-rtu-master --user-data <dir> --clean \
  --board "Arduino Mega" --board "Arduino Due (Programming Port)" --board "Arduino Leonardo" \
  --board "Arduino Micro" --board "ESP32 Generic" --board "Arduino Opta" --board "Raspberry Pico" \
  --board "Nano RP2040 Connect" --out /tmp/mm-d.jsonl
npm run compile:matrix -- /tmp/mm-projects/compile-rtu-master-no-pin --user-data <dir> --clean --no-build \
  --board "Arduino Mega" --board "Arduino Due (Programming Port)" --board "Arduino Leonardo" \
  --board "Arduino Micro" --board "ESP32 Generic" --board "Arduino Opta" --board "Raspberry Pico" \
  --board "Nano RP2040 Connect" --out /tmp/mm-d-no-pin.jsonl
npm run compile:matrix -- /tmp/mm-projects/compile-rtu-master-fx3u --user-data <dir> --clean --no-build \
  --board "WS3U-14Mx" --board "FX3U-24MR / DollaTek" --out /tmp/mm-d-fx3u.jsonl
find /tmp/mm-projects/compile-rtu-master*/build -name modbus_master_config.h -exec grep -H '&Serial' {} +
```

The projects have every FC on `Drive` (slave id 1, timeout 500 ms) and a second device, `Drive2` (slave id 2,
timeout 200 ms), on the same UART at 19200 bd, even parity. `compile-rtu-master` gives `Serial1` the RS-485 pin
`4`, `compile-rtu-master-no-pin` none, and `compile-rtu-master-fx3u` puts both devices on `Serial3`, where the
package fixes `PA14`. `<dir>` holds the RTOP-410 packages: a local build that accepts the running editor until
the signed packages land (see "Open prerequisites").

Pass: every board compiles, and the bus row of each build is `{ &Serial1, 19200, MB_PARITY_E, 1, 8, 200, 4 }`
(`MB_MASTER_NO_PIN` without a pin; `{ &Serial3, 19200, MB_PARITY_E, 1, 8, 200, PA14 }` on the FX3U boards). A
board that does not fit is reported with the compiler's message from the JSONL log (RSK04); any other failure
fails the phase. These builds already pass with the TCP master's firmware, which compiles the RTU buses out:
they prove the toolchains, and the bench checks below are the failing-first evidence.

### (e) The Modbus RTU server builds the same image as on `development`

`compile-rtu-server-secondary` (the RTU server on `Serial1`, so `MBSERIAL_ON_SECONDARY`) and
`compile-rtu-server-default-uart` (the RTU server on the default UART beside the debugger) are 4.3.x projects
with the legacy RS-485 pin `7` (`enable_rs485_en_pin`, `rs485_en_pin`) and no remote device. Build both on
Arduino Mega, ESP32 Generic and Arduino Opta from this branch and from `development`, as in (b), with the same
`--user-data` holding the production packages in both trees (the projects need no master capability), then
compare:

```sh
for p in compile-rtu-server-secondary compile-rtu-server-default-uart; do
  TS_NODE_TRANSPILE_ONLY=true npx ts-node scripts/bench/modbus-master/compare-images.ts \
    /tmp/mm/development/$p/build /tmp/mm/branch/$p/build
done
```

The comparison is on normalised symbol names, as in (b). Pass, per target: `SAME`; or `DIFF` where every
`symbol added` and `symbol removed` line names a symbol defined in `Baremetal/modbus_rs485.cpp` (the helper's own symbols, as `nm` lists them for that file's object in the
branch build), and the `section` lines come only with such symbol lines. Any other symbol added or removed, or
a section change with no helper symbol, fails. Run (b) again on this branch too, with the same rule: the
debugger's serial path goes through the same helper.

### (f) The web Simulator build stays green

In openplc-web, as in (c), build `tc08-rtu-every-fc` with the board `OpenPLC Simulator`. Pass: the build
succeeds and runs in the Simulator, shows the Simulator's "remote devices are ignored" warning, and its
`/compile-arduino` request carries `src/modbus_master_config.h` with `#define MB_MASTER_ENABLED 0`.

### RTU bench checks

| Check | Project | Board | Runs |
| --- | --- | --- | --- |
| TC08, AC02 every FC; UC08 enable pin | `tc08-rtu-every-fc` | Mega + USB-TTL | hardware, analyzer for the pin |
| BR10 bus timeout, BR12 unanswered slave | `br10-br12-rtu-bus-timeout` | Mega + USB-TTL | hardware |
| TC10 excess bytes, AS-11 rows 1-2 | `tc10-as11-rtu-oversized` | Mega + USB-TTL | hardware |
| TC10 wrong slave id, wrong FC, bad CRC | `tc10-as11-rtu-oversized` | Mega + USB-TTL | hardware |
| RS-485 enable pin out of the HAL pin masks | added with the run: `tc08-rtu-every-fc` with pin 22 also mapped as a digital output the program toggles | Mega + USB-TTL | pending: Mega, analyzer |
| Echoing transceiver | `tc08-rtu-every-fc`, `tc10-as11-rtu-oversized` | Mega + RS-485 transceivers | pending: Mega, transceivers |
| AS-12 | `as12-rtu-late-response` | Mega + USB-TTL | hardware |
| AS-07 RTU rows | `as07-rtu-19200`, `as07-rtu-115200` | Mega + USB-TTL | hardware, analyzer |
| AS-04 row 3 | `as04-row3-mega-w5500-rtu-server` | Mega + W5500 + two USB-TTL | hardware |

`tc08-rtu-every-fc` (its RS-485 pin) and `as04-row3-mega-w5500-rtu-server` (its TCP master) need the RTOP-410
packages; the other RTU bench projects build with the production packages.

### TC08: every FC over RTU (AC02), and the enable pin (UC08)

1. Slave: `--scenario normal --serial <adapter> --baud 19200 --map scripts/bench/modbus-master/maps/tc01.json
   --log tc08.jsonl`, on a Mac for AC02. Upload `tc08-rtu-every-fc`, start the PLC, open the debugger.
2. Expect: `fc1_0..2` = TRUE, FALSE, TRUE; `fc2_0..1` = FALSE, TRUE; `fc3_0` = 1234 and `fc3_3` = 4321;
   `fc4_0..1` = 42, 7.
3. Writes: `step` increases every second. The slave's log shows FC 5 to offset 20, FC 6 to offset 20, FC 15 to
   offsets 30 to 32 and FC 16 to offsets 30 to 31 with the program's values; `back5_0` = `fc5_0`, `back6_0` =
   `fc6_0`, `back15_*` = `fc15_*`, `back16_*` = `fc16_*` within one poll.
4. One request in flight: between two consecutive `request` events of the log there is a `tx` answering the
   first, or at least 500 ms.
5. Idle line: on the analyzer, each request's first start bit on TX1 follows at least 1.8 ms (3.5 characters of
   10 bits at 19200 bd) of silence on both TX1 and RX1.
6. Enable pin: pin 22 rises before the first start bit of every request, falls after its last stop bit, and is
   low between requests. Record the delay from the last stop bit to the fall; enable timing on a real
   transceiver is out of scope (CON07).
7. The board does not reset (toggle and debugger) for 10 minutes.

### BR10 and BR12: the bus timeout is the smallest, and a silent slave keeps being polled

`br10-br12-rtu-bus-timeout`: `Present` (slave id 1, timeout 200 ms, `present_0..1` at offset 0, cycle 1 s) and
`Absent` (slave id 2, timeout 500 ms, `absent_0` at offset 0, cycle 100 ms) on `Serial1`. Slave `--scenario normal
--serial <adapter> --baud 19200 --map scripts/bench/modbus-master/maps/g1-1234-5678.json --log br10.jsonl`, for
5 minutes; the slave never answers unit 2.

Expect: `present_0`, `present_1` = 1234, 5678 and `absent_0` = 0; every `ignored` frame (unit 2) is followed by
the next frame on the line within 320 ms (the smallest timeout, 200 ms, the one-cycle wait after a failed poll,
100 ms, the request's transmit time and 3.5 characters make about 305 ms; with `Absent`'s own 500 ms timeout the
gaps would be about 605 ms); `ignored` frames keep coming until the end, at most 350 ms apart; `Present`'s
requests at most 1.3 s apart.

### TC10 and AS-11: an RTU response longer than requested

`tc10-as11-rtu-oversized`: sentinel G2 (1 register at offset 10, cycle 60 s, `g2_0`) first, then G1 (10
registers at offset 0, cycle 100 ms, `g1_0..9`). For each row: `--scenario AS-11 --row <n> --serial <adapter>
--baud 19200 --map scripts/bench/modbus-master/maps/g2-23130.json --log as-11-row<n>.jsonl`, then reset the
board so the master starts against the running slave.

- Precondition: the log shows G2's request (address 10) answered (`tx`) before the `hostile` phase. If not,
  reset the board and repeat.
- Row 1 (TC10 excess bytes: byte count 40, 40 data bytes, valid CRC) and row 2 (300 bytes with no gap): expect
  `g1_*` = 0 after the hostile answer, never the 201.. values it carries; `g2_0` still 23130, read before G2's
  next poll (row 1's twenty words would put 211 there); the toggle and the debugger alive; then `g1_*` =
  501..510 at the next G1 request. Row 2: the next G1 request starts only after the 300 bytes end.
- The slave answers the first G1 request with the hostile frame, so the scenario's 101..110 baseline is not
  played; the discriminating oracles are the absence of 201.., the sentinel and the recovery.
- TC10 wrong slave id, wrong FC and bad CRC: `--scenario TC10 --row <n> --serial <adapter> --baud 19200 --map
  scripts/bench/modbus-master/maps/g2-23130.json --log tc10-row<n>.jsonl`, rows 1 (slave id 2), 2 (FC 0x04) and 3
  (both CRC bytes inverted), each carrying byte count 20 and the values 201..210. Their oracles are the AS-11
  rows': one failed poll (`g1_*` = 0, never the malformed values), the sentinel kept, then `g1_*` = 501..510 at the
  next G1 request.

### RS-485 enable pin out of the HAL pin masks

Board: Mega. Build `tc08-rtu-every-fc` (RS-485 pin 22 on `Serial1`) with pin 22 also mapped as a digital output
that the program toggles every scan; this variant is built at the run and not committed. Expect, on the analyzer,
pin 22 to change only around the master's requests (high from before the first start bit to after the last stop
bit), never at the program's toggle rate. Without the exclusion the HAL drives pin 22 every scan. A build with
no remote devices keeps its image (compile check (b)). Status: pending, Mega and the analyzer.

### Echoing transceiver

Board: Mega with RS-485 transceivers on `Serial1`. Tie the master transceiver's RE low so its receiver stays on
while it transmits, and run TC08 (every FC): the values match. Then run TC08 and AS-11 through the non-echoing
setup of "RTU setup": unchanged. The master discards what it receives from the start of a request to 3.5
characters after its estimated end, so an echo is never read as the response; a master pass that comes later
than that window cannot tell an echo from a response (the RS-485 enable limit). Status: pending, Mega and the
transceivers.

### AS-12: a late RTU response is rejected by its shape

`as12-rtu-late-response`: sentinel G3 (1 register at offset 20, cycle 60 s, `g3_0`) first, then G1 (10 registers
at offset 0, `g1_0..9`) and G2 (2 registers at offset 10, `g2_0..1`), both every 100 ms. Slave `--scenario AS-12
--serial <adapter> --baud 19200 --log as-12.jsonl`, then reset the board.

- Precondition: G3's request (address 20) answered before the `late-response` phase; otherwise reset and repeat.
- Expect: after the late answer (G1's frame, byte count 20, 1111..1120, sent to G2's request), `g2_0`, `g2_1` =
  0, never 1111, 1112; `g3_0` still 23130 (an overrun would put 1113 there); then `g2_0`, `g2_1` = 3333, 4444 at
  the next G2 request, and `g1_*` = 1111..1120 afterwards.
- Accepted residual: a late reply with the same slave id, FC and byte count cannot be told apart.

### AS-07 RTU rows: a flood of unsolicited bytes

`as07-rtu-19200` and `as07-rtu-115200`: G1 (2 registers at offset 0, cycle 100 ms, `g1_0..1`). For each, at the
project's baud: run `normal --map scripts/bench/modbus-master/maps/g1-1234-5678.json` until `g1_0`, `g1_1` = 1234,
5678, stop it, then start `--scenario AS-07 --serial <adapter> --baud <19200|115200> --log as-07-rtu-<baud>.jsonl`.
As in the TCP row, the restart already zeroes G1, so "reads 0" is not the discriminating oracle there.

Expect: no idle gap of 3.5 characters on RX1 during the 60 s flood (analyzer: the flood is real); the worst scan
within baseline + 2 ms during it; `g1_*` = 0 during it; no reset or hang; then `g1_*` = 4321, 8765.

### AS-04 row 3: the RTU server's line never reaches the master's pending response

`as04-row3-mega-w5500-rtu-server`: the TCP master polls `192.168.1.50:502` (G1, 10 registers at offset 0, cycle
300 ms, `g1_0..9`), the program holds 7000..7009 in `held_0..9` (`%QW0`..`%QW9`) and counts in `bad_steps`
(`%QW10`) every `g1_0` that is not the previous value plus 1, and the Modbus RTU server (slave id 1, 19200 bd)
is on `Serial2`. Slave `--scenario AS-04 --row 3 --tcp-listen 192.168.1.50:502 --client-serial <adapter on
Serial2> --client-baud 19200 --client-unit 1 --log as-04-row3.jsonl`.

Expect after 50 rounds: `bad_steps` = 0; `g1_0` equal to the last `counter` of the slave's `poll` events; every
`response` of the client role = 7000..7009; each client request inside a 200 ms wait of the master (between
G1's `request` and its delayed `tx` in the log). This check holds before and after the RTU master: it guards M3
for the RTU server through the helper extraction.
