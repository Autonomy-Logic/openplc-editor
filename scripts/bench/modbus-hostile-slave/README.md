# Scripted hostile Modbus slave (bench tool)

A command-line tool that plays a well-behaved Modbus slave and the scripted hostile slave, client and attacker
roles of the Modbus master bench scenarios (AS-01 to AS-04, AS-06 to AS-13, TC10 and TC28), over Modbus TCP and Modbus RTU
(USB-TTL), and writes a timestamped script log.

It is bench tooling only: it lives outside `src/`, so it is not on the shared surface with openplc-web, is not
built into the editor and cannot be imported by product code.

## Setup

- Node.js 20 or 22 and the repository's dependencies (`npm install`). The tool uses `ts-node`, Node's `net` and the
  `serialport` package the editor already depends on; it adds no dependency.
- TCP scenarios: the bench host on the board's network, with the address the board's Modbus remote device points at
  (the commands below use `192.168.1.50`) assigned to one of its interfaces:
  - Linux: `sudo ip addr add 192.168.1.50/24 dev <interface>`
  - macOS: `sudo ifconfig <interface> alias 192.168.1.50 255.255.255.0`
- RTU scenarios: a USB-TTL adapter wired to the board's `Serial1`: adapter TX to the board's RX, adapter RX to the
  board's TX, common ground, at the board's logic level. The bench runs at 19200 bd and at 115200 bd; use the
  speed, parity and stop bits of the board's remote device. A second adapter is needed for AS-04 rows 2 and 3.
- A packet capture (Wireshark or `tcpdump`) runs next to the tool: the pcap is the network evidence, the script log
  is the tool's evidence.

## Command line

```bash
npm run bench:hostile-slave -- --scenario <name> [--row <n>] \
  (--tcp-listen <ip:port> | --serial <path> --baud <n> [--parity N|E|O] [--stop 1|2]) \
  [--board <ip[:port]>] [--log <file.jsonl>]
```

| Option                                     | Meaning                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scenario <name>`                        | `normal`, `AS-01`, `AS-02`, `AS-03`, `AS-04`, `AS-06`, `AS-07`, `AS-08`, `AS-09`, `AS-10`, `AS-11`, `AS-12`, `AS-13`, `TC10` or `TC28`. An unknown name stops the tool with exit code 2 before it listens.                                |
| `--row <n>`                                | Row of the scenario: AS-02 1-9, AS-04 1-3, AS-09 1-2, AS-11 1-2, TC10 1-3, TC28 1-2. Required by those scenarios, refused by the others.                                                                                                  |
| `--tcp-listen <ip:port>`                   | Slave role over Modbus TCP, listening only on that address. Port `0` takes a free port, reported in the `listening` event. The wildcard addresses `0.0.0.0` and `::` are refused.                                                         |
| `--serial <path> --baud <n>`               | Slave role over Modbus RTU on that serial port, 8 data bits. `--parity` defaults to `N`, `--stop` to `1`.                                                                                                                                 |
| `--board <ip[:port]>`                      | The board, for the `client` role of AS-04 row 1 (default port 502) and the `attacker` role of AS-08 (default port 102) and AS-13 (default port 502). The tool never sends to any other address.                                           |
| `--log <file.jsonl>`                       | Script log file, truncated at start. Without it the log goes to stdout.                                                                                                                                                                   |
| `--map <file.json>`                        | Register map of the slave: `{ "coils": { "0": 1 }, "discreteInputs": {}, "holdingRegisters": { "0": 1234 }, "inputRegisters": {} }`. An address absent from the map reads 0.                                                              |
| `--groups g1=<addr>,g2=<addr>,g3=<addr>`   | Starting holding-register address of the poll groups, read with FC 3 on unit 1. Defaults: G1 at 0 (10 registers), G2 at 10 (1 register, 2 in AS-03 and AS-12), G3 at 20 (1 register). Any group can be given alone.                       |
| `--duration-scale <factor>`                | Multiplies the long durations: the 5 minutes of AS-06, the 60 s of AS-07, the 15 minutes of AS-10 and the 60 s of AS-13. The 400 ms byte interval of AS-06, the 200 ms delay of AS-04 and the 200 or 500 ms delay of TC28 are not scaled. |
| `--client-serial <path> --client-baud <n>` | Second serial line of the `client` role, AS-04 rows 2 and 3. `--client-parity` and `--client-stop` as above.                                                                                                                              |
| `--client-unit <id>`                       | Unit id of the board's Modbus RTU server for AS-04 row 3. Default 1.                                                                                                                                                                      |
| `--debug-index <arr:elem>[,...]`           | Debug addresses (`arr:elem`) of the variables at `%QW0`..`%QW9`, taken from the project's STruC++ debug map, for AS-04 row 2.                                                                                                             |

The slave answers unit id 1 on RTU and ignores the frames of other unit ids; on TCP the `normal` answers echo the
request's unit id and the scripted answers carry unit id 1. A request that is not a poll group read gets the
`normal` answer in every scenario. The scenario's script is shared by every TCP connection of a run, so it carries
on when the board reconnects.

`SIGTERM` or `Ctrl+C` stops the tool with exit code 0. The tool also exits with code 0 when nothing is left to do,
for example after AS-13 released its connections.

## Script log

One JSON object per line, in order, each with `t_us`: microseconds since the tool started, from the monotonic clock.
Events of a role carry `role` (`slave`, `client` or `attacker`); events of a TCP connection carry `peerAddress` and
`peerPort`.

| `event`                                            | Fields                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `start`                                            | `scenario`, `row`, `transport`, `duration_scale`, `groups`                                           |
| `listening`                                        | `host`, `port` (the bound port)                                                                      |
| `accepted`, `closed`                               | `peerAddress`, `peerPort`                                                                            |
| `opened`                                           | `path`, `baud`, `parity`, `stop` (a serial line)                                                     |
| `rx`, `tx`                                         | `hex`: every block of bytes received and sent                                                        |
| `request`                                          | `tid` (TCP), `unit`, `fc`, `address`, `quantity`                                                     |
| `discarded`, `ignored`, `withheld`                 | Bytes that are not a frame, an RTU frame for another unit id, a request the script leaves unanswered |
| `phase`                                            | `phase` and the phase's fields, at each scenario change                                              |
| `poll`                                             | AS-04: `poll` number and `counter`                                                                   |
| `late-answer`                                      | TC28: `tid` and `delay_ms` of each delayed answer, when it is sent                                   |
| `connected`, `connect-failed`, `response`, `error` | Client and attacker connections and answers                                                          |
| `stopped`                                          | `code`, last line                                                                                    |

## Scenarios

Every scripted frame is valid in every field except the one under test: the pending transaction id, protocol id 0,
unit id 1, FC 3 and a matching MBAP length. Malformed answers carry the register values 201, 202, ... so a
malformed frame the board accepted shows on the board.

### normal

A well-behaved slave for FC 1, 2, 3, 4, 5, 6, 15 and 16, with the `--map` registers. Slave simulator of TC01, TC02,
TC05, TC08 and TC11.

```bash
npm run bench:hostile-slave -- --scenario normal --tcp-listen 192.168.1.50:502 --map map.json --log normal.jsonl
npm run bench:hostile-slave -- --scenario normal --serial /dev/ttyUSB0 --baud 19200 --parity E --map map.json --log normal-rtu.jsonl
```

### AS-01 (TCP)

G1 answered with 101..110 and G2 with 23130; once both were answered, the next G1 gets an MBAP length of 65535
followed by 1000 bytes; every later G1 gets 501..510. G2 keeps 23130.

```bash
npm run bench:hostile-slave -- --scenario AS-01 --tcp-listen 192.168.1.50:502 --log as-01.jsonl
```

### AS-02 rows 1-9 (TCP)

The AS-01 baseline (G1 101..110, G2 23130), then one malformed answer to G1, then 501..510 on every later G1:

| Row | Answer to G1                                                                               |
| --- | ------------------------------------------------------------------------------------------ |
| 1   | Byte count 40, 40 data bytes, MBAP length 43                                               |
| 2   | Byte count 10, 10 data bytes, MBAP length 13                                               |
| 3   | Byte count 20, 6 data bytes, MBAP length 9                                                 |
| 4   | MBAP length 23, then only 9 bytes (unit id, FC, byte count 20, 6 data bytes), then silence |
| 5   | Exception frame `83 02` under G1's transaction id                                          |
| 6   | A valid answer with transaction id + 1                                                     |
| 7   | A valid answer with protocol id 1                                                          |
| 8   | A valid answer with unit id 2                                                              |
| 9   | A valid answer with FC 4                                                                   |

```bash
npm run bench:hostile-slave -- --scenario AS-02 --row 1 --tcp-listen 192.168.1.50:502 --log as-02-row1.jsonl
```

### AS-03 (TCP)

G3 answered with 23130; G1 not answered; on G2's request, G1's late answer (G1's transaction id, 1111..1120) and
then G2's answer (3333, 4444). After that G1 gets 1111..1120 and G2 3333, 4444.

```bash
npm run bench:hostile-slave -- --scenario AS-03 --tcp-listen 192.168.1.50:502 --log as-03.jsonl
```

### AS-04 rows 1-3 (TCP or RTU)

Each G1 request is answered 200 ms later, all ten registers holding a counter that goes up by one per poll. On each
of the first 50 G1 requests, the `client` role first sends a read of `%QW0`..`%QW9`:

| Row | Client read                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modbus TCP FC 3, holding registers 0-9, unit 1, to the board's Modbus TCP server (`--board`)                              |
| 2   | Debugger FC 0x44 of the `--debug-index` addresses, unit 1, on the board's default UART (`--client-serial`)                |
| 3   | Modbus RTU FC 3, holding registers 0-9, to unit `--client-unit` on the board's Modbus RTU server line (`--client-serial`) |

```bash
npm run bench:hostile-slave -- --scenario AS-04 --row 1 --tcp-listen 192.168.1.50:502 --board 192.168.1.100 --log as-04-row1.jsonl
npm run bench:hostile-slave -- --scenario AS-04 --row 2 --serial /dev/ttyUSB0 --baud 19200 --client-serial /dev/ttyUSB1 --client-baud 115200 --debug-index 0:0,0:1 --log as-04-row2.jsonl
npm run bench:hostile-slave -- --scenario AS-04 --row 3 --serial /dev/ttyUSB0 --baud 19200 --client-serial /dev/ttyUSB1 --client-baud 19200 --client-unit 1 --log as-04-row3.jsonl
```

### AS-06 (TCP or RTU)

From the first request and for 5 minutes, every answer (the `normal` answer) is sent one byte every 400 ms, answers
queued one after the other.

```bash
npm run bench:hostile-slave -- --scenario AS-06 --tcp-listen 192.168.1.50:502 --log as-06.jsonl
```

### AS-07 (TCP or RTU)

On the first request, 0xFF sent continuously at full rate for 60 s (on RTU with no 3.5-character gap: blocks sized
for twice the line rate keep the port's output buffer full), then the answer 4321, 8765 to that request. Over TCP
the flood follows reconnections: every connection open while it lasts receives it, including one the board opens
after closing the first, and it stops on all of them when the 60 s end. Requests during the flood are not answered
(logged `withheld`); afterwards every poll group gets 4321, 8765.

```bash
npm run bench:hostile-slave -- --scenario AS-07 --tcp-listen 192.168.1.50:502 --log as-07-tcp.jsonl
npm run bench:hostile-slave -- --scenario AS-07 --serial /dev/ttyUSB0 --baud 115200 --log as-07-rtu.jsonl
```

### AS-08 (attacker, optional slave)

The `attacker` opens connections to the board's S7 port (102 unless `--board` gives another) one after another and
holds each one, retrying every 250 ms while the board does not answer (start it before powering the board on). A
connection attempt with no answer is dropped after 3 s. Adding `--tcp-listen` or `--serial` runs a `normal` slave in
the same process.

```bash
npm run bench:hostile-slave -- --scenario AS-08 --board 192.168.1.100 --tcp-listen 192.168.1.50:502 --log as-08.jsonl
```

### AS-09 rows 1-2 (TCP)

No listener on the `--tcp-listen` address until `accept` and Enter are typed on the tool's standard input; then a
`normal` listener. Node cannot see SYN segments, so the pcap is the evidence of each SYN and of the answer to it.

- Row 1, reset mode: nothing else to do; the OS answers each SYN with RST.
- Row 2, drop mode: before the run, drop the SYN segments, and remove the rule before typing `accept`:
  - Linux: `sudo iptables -I INPUT -p tcp -d 192.168.1.50 --dport 502 --syn -j DROP`, removed with the same
    command with `-D` in place of `-I`.
  - macOS: `echo "block drop in quick proto tcp from any to 192.168.1.50 port 502 flags S/SA" | sudo pfctl -a com.apple/bench -f -`
    and `sudo pfctl -e`, removed with `sudo pfctl -a com.apple/bench -F rules`.

```bash
npm run bench:hostile-slave -- --scenario AS-09 --row 1 --tcp-listen 192.168.1.50:502 --log as-09-reset.jsonl
```

### AS-10 (TCP)

On the first request the tool stops reading every connection and answers nothing for 15 minutes, then reads again
and answers every poll group with 4321, 8765, the requests received meanwhile included. Node cannot set a socket's
receive buffer, so shrink it in the OS before the run and restore it after:

- Linux: note `sysctl net.ipv4.tcp_rmem`, then `sudo sysctl -w net.ipv4.tcp_rmem="4096 4096 4096"`.
- macOS: note `sysctl net.inet.tcp.recvspace net.inet.tcp.doautorcvbuf`, then
  `sudo sysctl -w net.inet.tcp.doautorcvbuf=0 net.inet.tcp.recvspace=4096`.

Node still reads a paused socket up to its stream high-water mark (16 KiB on Node 20, 64 KiB on Node 22) before the
kernel window fills. Confirm the zero
window in the pcap with the Wireshark filter `tcp.analysis.zero_window` on the tool's side of the connection.

```bash
npm run bench:hostile-slave -- --scenario AS-10 --tcp-listen 192.168.1.50:502 --log as-10.jsonl
```

### AS-11 rows 1-2 (RTU)

The first G1 request gets a malformed answer, every later one 501..510:

- Row 1: slave 1, FC 3, byte count 40, 40 data bytes and a valid CRC.
- Row 2: 300 bytes written as one block with no inter-frame gap: slave 1, FC 3, byte count 20, then data.

```bash
npm run bench:hostile-slave -- --scenario AS-11 --row 1 --serial /dev/ttyUSB0 --baud 19200 --log as-11-row1.jsonl
```

### TC10 rows 1-3 (RTU)

The first G1 request (FC 3, 10 registers) gets a malformed answer carrying 201..210, every later one 501..510; the
other groups get their `normal` answers. Over TCP the tool stops with exit code 2.

- Row 1, wrong slave id: slave 2, FC 3, byte count 20, 20 data bytes and a valid CRC.
- Row 2, wrong FC: slave 1, FC 0x04, byte count 20, 20 data bytes and a valid CRC.
- Row 3, bad CRC: slave 1, FC 3, byte count 20, 20 data bytes, both CRC bytes inverted.

```bash
npm run bench:hostile-slave -- --scenario TC10 --row 1 --serial /dev/ttyUSB0 --baud 19200 --log tc10-row1.jsonl
```

### TC28 rows 1-2 (TCP)

The smallest timeout on a shared endpoint (TC28 (a)). Every request whose unit id is not 1 gets its `normal` answer
from `--map` at once. The first 20 FC 3 requests with unit id 1 get their `normal` answer at once too; every later
one is answered after the row's delay with 4321, 8765 (0 for any further register), on the scenario clock and only
if the connection is still open. The `phase` event `late-answers` carries `delay_ms` when the delayed answers start,
and each delayed answer logs a `late-answer` event. Over RTU the tool stops with exit code 2.

- Row 1: the delayed answers come 200 ms after the request.
- Row 2: the delayed answers come 500 ms after the request.

```bash
npm run bench:hostile-slave -- --scenario TC28 --row 1 --map scripts/bench/modbus-master/maps/g1-1234-5678.json --tcp-listen 192.168.1.50:502 --log tc28-row1.jsonl
```

### AS-12 (RTU)

G3 answered with 23130; G1 not answered; the next G2 request gets G1's answer (byte count 20, 1111..1120, valid
CRC); the G2 request after it gets 3333, 4444. After that G1 gets 1111..1120.

```bash
npm run bench:hostile-slave -- --scenario AS-12 --serial /dev/ttyUSB0 --baud 19200 --log as-12.jsonl
```

### AS-13 (attacker, optional slave)

The `attacker` opens connections to the board's port 502 (start it before powering the board on) and holds them,
until an attempt gets no SYN-ACK (refused, or no answer within 3 s) after one that did. It then logs the `saturated`
phase with `last_syn_ack_us`, the time of the last SYN-ACK seen, and releases every connection 60 s later (the
`released` phase).

```bash
npm run bench:hostile-slave -- --scenario AS-13 --board 192.168.1.100 --tcp-listen 192.168.1.50:502 --log as-13.jsonl
```

## Tests and checks

```bash
npm run test:bench
```

`npm run test:bench` also runs the tests of `scripts/bench/modbus-master/`. The tool's own tests alone, without npm:

```bash
TS_NODE_TRANSPILE_ONLY=true node --require ts-node/register --test scripts/bench/modbus-hostile-slave/__tests__/*.test.ts
```

The tests run each scenario on an in-memory stream with a virtual clock, and the CLI on loopback TCP. `npm run lint`
does not cover the tool: it lints `src/` only and the ESLint configuration ignores `scripts/`. The tool is outside
the `tsc` project (`include: ["src"]`) and outside the Jest roots, so neither CI nor `compare-surfaces.py` sees it.
