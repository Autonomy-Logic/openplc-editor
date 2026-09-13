# S7Comm on the baremetal runtime

What the server does, what it deliberately does not do, and the limits a project
has to live inside. Written for the LOGO! 8.2, which is the only target that
enables it today; everything here is per-target and declared by the VPP.

## What you get

A **Siemens S7 server over ISO-TCP (RFC 1006) on TCP port 102** — the protocol an
HMI, a SCADA system, TIA Portal or another PLC already speaks. Configured from the
same S7Comm screen Runtime v4 uses, so a project moves between the two runtimes
without rework.

On a LOGO! this is not a foreign protocol. Stock LOGO! 8.2 firmware listens on
port 102, and S7 is how a LOGO! talks to HMIs, to other LOGO!s and to SCADA. An
installation configured against a Siemens LOGO! keeps working against an OpenPLC
one — which no other protocol we could have implemented would have given you.

The rule this implementation follows is **parity with Runtime v4 or less, never
more**. A baremetal PLC exposing capabilities the flagship runtime lacks would be
a support problem before it was a feature.

| | Runtime v4 | baremetal |
|---|---|---|
| Setup Communication (PDU negotiation) | yes | yes |
| Read Var / Write Var | yes | yes |
| Bit, Byte, Word, DWord, Int, DInt, Real, Timer, Counter | yes | yes |
| Multi-item requests | yes | yes, up to 20 items |
| System areas (I / Q / M) | yes | yes |
| Data blocks | 64 | **8** — see *Limits* |
| Identification (SZL) | yes | yes, when `szl` is on — see *Identification* |
| CPU start / stop | yes | yes, and it is refused unless the runtime agrees |
| Block upload / download | yes | **no** — there is nothing to upload |
| Block listing, clock get/set, password | yes | **no** |
| S7CommPlus (S7-1200/1500) | no | **no** |

## There is no security. None.

**Classic S7 has no authentication and no encryption.** Anyone who can reach port
102 can read and write every area the project publishes, and — if the runtime
allows it — stop the PLC.

That is the protocol, not this implementation. A genuine S7-300 offers exactly
the same guarantee, and so does stock LOGO! firmware. There is no password to
set, no certificate to install, and no mode that adds one; S7CommPlus, which does
have session security, is a different protocol and is out of scope.

So:

- Put the device on a **trusted network segment**. Not a plant-wide flat network,
  and never a routable one.
- Consider a **read-only server**. The VPP's `writeEnabled: false` makes every
  Write Var return "access denied" — a proper S7 error, not a dropped connection,
  so clients report it clearly. For a device that only needs to be monitored this
  removes the entire write surface.
- **Do not enable CPU control** unless something genuinely needs it. Start/stop is
  refused outright unless the runtime's own state machine agrees, and a request to
  run while the mode switch reads STOP is refused exactly as it is over Modbus —
  but the safest configuration is the one where an unauthenticated packet cannot
  ask at all.

## Limits

Declared per target in the VPP's `capabilities.s7` block; the LOGO! 8.2 values:

| | value | why |
|---|---|---|
| `maxClients` | 2 | each costs a receive/transmit PDU pair — the dominant RAM cost |
| `pduSize` | 480 | negotiated down if the client asks for less; RAM is `2 x pduSize` per client |
| `maxDataBlocks` | 8 | the area table is `const` in flash, so this is a build-time check, not a RAM one |
| items per request | 20 | bounds the work one request can demand of a scan cycle |
| `szl` | on | identification; costs 228 B of flash |
| `writeEnabled` | on | see the security note above |

A project that exceeds a limit is told **at build time**, with the data block
named, rather than producing a device that answers some addresses and not others.
A client that asks for more than 20 items in one request gets the first 20 served,
which is what Snap7 does and therefore what clients were written against.

**Footprint on the LOGO! 8.2**, measured: 4,248 B of flash and 2,568 B of RAM,
against OPC-UA's 187,909 B and 65,536 B on the same device. Both servers run at
once comfortably. A project with no S7 server configured produces a byte-identical
image to one built before the feature existed.

## Addressing

An S7 area is a flat run of bytes mapped onto OpenPLC's located variables. The
mapping is the one the editor's S7 screen already asks for — a buffer and a
starting index — and it is **the same mapping Runtime v4 uses**, so a variable
resolves identically on both.

| S7 address | reaches |
|---|---|
| `MB0`, `MW0`, `MD0` | the merker area, mapped to `%MW` / `%MD` |
| `DB1.DBW0` | a data block, mapped to whichever buffer the project chose |
| `IB0`, `IW0` | the process-input area, mapped to `%IX` / `%IW` |
| `QB0`, `QW0` | the process-output area, mapped to `%QX` / `%QW` |

Some things worth knowing:

- **The process-input area is read-only.** It is what the field wires drive, so a
  client writing it would be writing a value the next input refresh overwrites —
  which looks to the client like the write was silently lost. It is refused
  instead.
- **Everything is big-endian on the wire**, as S7 requires, regardless of the
  device's own byte order. A `%MW` holding 4660 reads back as `0x1234`.
- **A bit write touches exactly one bit.** Writing `Q0.1` does not disturb `Q0.0`
  or `Q0.2`, which matters when those are seven other physical outputs.
- **An unbound located variable reads as 0 and ignores writes.** If the project
  declares `%MW7` and nothing uses it, the address still exists and answers —
  rather than one unused address failing a read that spans it.
- Buffers that exist only on Runtime v3/v4 — `bool_memory` (`%MX`) and the
  `byte_*` buffers — have no equivalent here. The build says so and names the
  block.

## Identification

With `szl` on, the server answers the System Status List with the identity from
the project's S7 screen: station name, module name, serial number, copyright.
Many clients ask for this **before** doing anything else — `python-snap7` never
does, but TIA Portal and several HMIs do, and some refuse to talk to a device
that will not answer.

The order code the server publishes is a real S7-315's (`6ES7 315-2EH14-0AB0`).
There is no OpenPLC order code a client could have heard of, and one it
recognises is one it knows how to talk to.

With `szl` off, every SZL request is answered "not available" — which is a real
CPU's answer for an SZL it does not keep, and costs nothing to a client that only
reads and writes.

## Scan-cycle behaviour

The PLC cycle comes first, always. The server is serviced **at least once every
sync interval** and more often whenever the scan has slack left. It never starts
work it cannot finish inside the remaining slack, so it cannot push a cycle past
its deadline, and it **never waits on a client** — a reply that cannot be sent
without blocking drops that connection instead, which the client retries.

When OPC-UA is enabled too, the two share **one** budget rather than having one
each: the remaining slack is recomputed between them, so the second sees what the
first actually spent. Two protocols each politely taking "their" slack from the
same number would together overrun the cycle.

Measured on a LOGO! 8.2 with a 20 ms cycle:

| | |
|---|---|
| S7 reads, alone | 1,617/s, median 0.5 ms, p95 0.8 ms |
| S7 reads, with Modbus and OPC-UA also loaded | ~600/s, median 1.8 ms, p95 3.6 ms |
| effect on Modbus latency | none measurable (median 0.4-0.6 ms throughout) |

## What happens under attack

The protocol has no authentication, so the server is written on the assumption
that anything may arrive. A 16-case adversarial suite runs against the device:
frames that are not ISO-TCP at all, TPKT lengths that lie, COTP headers longer
than their frames, S7 lengths that do not add up, item counts that lie about what
follows, reads of 65,535 elements, RST in the middle of a PDU, half-open
connection floods, connect churn, and a request dribbled one byte at a time. In
every case the PLC keeps scanning and a well-behaved client can still connect.

Two failures are treated differently, deliberately:

- A frame whose **framing** cannot be trusted closes the connection. A TPKT stream
  has no resynchronisation point, so continuing would mean parsing from an unknown
  offset.
- A frame that **parsed** but asks for something the server will not do is
  **answered** with a proper S7 error. Dropping the session there would cost the
  client everything else it was doing, and a timeout is the least informative
  failure there is.

## Connection slots are shared

S7 and OPC-UA draw accepted connections from one pool. It is sized for every
protocol's ceiling plus headroom, so normal use never exhausts it — but a burst of
reconnections across both protocols at once can briefly fill it, and a connection
refused then is refused **politely**, which a client retries. Over a ten-minute
three-protocol soak this showed up as a handful of retries out of tens of
thousands of operations.

## Testing it yourself

`python-snap7` is the easiest client to reach for:

```python
import snap7
c = snap7.client.Client()
c.connect("192.168.1.10", 0, 2, 102)   # rack 0, slot 2
print(c.get_cpu_info())
print(bytes(c.read_area(snap7.type.Areas.MK, 0, 0, 8)).hex())
```

Two of its quirks are worth knowing, because they look like device faults and are
not:

- `get_cpu_state()` is a **stub** in python-snap7 3.1.2. It sends a deliberately
  malformed request (its own comment says *"in real S7 this would be a userdata
  function"*) and then returns `"S7CpuStatusRun"` without reading the answer. The
  server answers it with a proper error, which python-snap7 raises. Read SZL
  `0x0424` directly if you want the real CPU mode.
- Its **single-item** bit read divides every declared length by 8 regardless of
  transport size, so it reads nothing from a correct one-bit answer. Its
  **multi-item** path parses the same bytes correctly. The server sends the length
  Snap7's own server sends, because the alternative would make Snap7's C client
  copy eight bytes into the one byte it allocated.
