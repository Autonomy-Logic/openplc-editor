# Modbus TCP master on baremetal: compile and bench checks

The baremetal firmware has no host test harness, so the Modbus TCP master is proven here: by compiling real
projects on real toolchains, by comparing images, and by running bench projects against the scripted hostile
slave (`scripts/bench/modbus-hostile-slave/`). The preprocessor gates and the source rules have their own Jest
tests in `src/frontend/utils/modbus-master/__tests__/` (see the README there).

Every check below names its project, the observation that passes it, and what the firmware without the master
shows instead (the negative control: build the same project from the branch before the master landed, where
the firmware ignores `modbus_master_config.h`).

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
the toolchain embeds build data, identical allocated section sizes and the same defined symbols.

### (c) The web Simulator build keeps the master out

In openplc-web (local-dev-toolkit or staging), with the board `OpenPLC Simulator`, build the TC01 project and
the same project with its remote device deleted. Pass: both builds succeed and run in the Simulator; the
remote-device build shows the Simulator's "remote devices are ignored" warning; in the browser's network tab,
the `/compile-arduino` request of both builds carries `src/modbus_master_config.h` with
`#define MB_MASTER_ENABLED 0`.

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
