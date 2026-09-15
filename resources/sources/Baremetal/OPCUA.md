# OPC-UA on the baremetal runtime

What the server does, what it deliberately does not do, and the limits a project
has to live inside. Written for the LOGO! 8.2, which is the only target that
enables it today; everything here is per-target and declared by the VPP.

## What you get

A **Nano Embedded Device Profile** OPC-UA server: browse the address space, read
and write PLC variables live, with per-role permissions. Configured from the same
OPC-UA screen Runtime v4 uses, so a project moves between the two runtimes
without rework.

The rule this implementation follows is **parity with Runtime v4 or less, never
more**. A baremetal PLC exposing capabilities the flagship runtime lacks would be
a support problem before it was a feature.

| | Runtime v4 | baremetal |
|---|---|---|
| Browse / Read / Write | yes | yes |
| viewer / operator / engineer permissions | yes | yes |
| Anonymous access | yes | yes |
| Username + password | yes | yes, with the caveat below |
| Security policies, certificates | yes | **no** — see *Security* |
| Subscriptions / monitored items | yes | **no** — see *No subscriptions* |

## Limits

Declared per target in the VPP's `capabilities.opcua` block; the LOGO! 8.2 values:

| | value | why |
|---|---|---|
| `maxSessions` | 1 | 16 KB of buffers per session — the dominant RAM cost |
| `maxNodes` | 1024 | the address space lives in flash, so this is generous |
| `maxNodesPerRead` / `Write` | 20 | bounds the work one request can demand of a scan |
| `maxNodesPerBrowse` | 10 | as above |
| `maxArrayLength` | 256 | elements beyond this are dropped at build time, with a warning |
| message size | 8192 B, 1 chunk | the OPC-UA Part 6 floor; conformant clients self-chunk |

Exceeding an operation limit is not an error in your client — the server
advertises them, and a conformant client splits its request. A client that
ignores them gets `BadTooManyOperations` rather than a stalled PLC.

## Scan-cycle behaviour

The PLC cycle comes first, always. The server is serviced **at least once every
`cycleTimeMs`** (the field on the OPC-UA screen) and more often whenever the scan
has slack left. It never runs when the remaining slack cannot absorb its worst
case, so it cannot push a cycle past its deadline.

The practical consequence: **`cycleTimeMs` is your latency floor when the scan is
busy.** On a scan interval tight enough that no slack is ever available, OPC-UA
response time settles at exactly `cycleTimeMs` — measured 99.2 ms at
`cycleTimeMs = 100` and 19.1 ms at 20, on a 5 ms scan. With normal slack it is
~1.4 ms. Lower `cycleTimeMs` for snappier OPC-UA at the cost of more scan
pressure; raise it if the PLC logic needs the cycle.

Cost when idle is zero: no connected client means no work and no overruns.

## No subscriptions

The server does not implement subscriptions or monitored items, so clients must
poll. This is a deliberate scope decision, not a hardware limit — subscriptions
are what separate the Micro Embedded Device Profile from the Nano one, and they
add per-monitored-item and per-notification RAM on the part whose memory budget
is the tightest thing in the design.

If your client offers a choice, configure it to poll. Runtime v4 does support
subscriptions, so a project that depends on them belongs there.

## Security — read this before deploying

**The LOGO! 8.2 runs OPC-UA with no encryption (`#None`) and that cannot be
changed on this hardware.** Its TM4C1294NCPDT is the non-crypto part: no true
random number generator, no SHA-256 or AES acceleration, no public-key
accelerator. There is no security policy for it to offer.

Concretely:

- **Traffic is in the clear.** Anyone who can see the network sees every value
  read and written.
- **Passwords are in the clear.** Username authentication exists, and it is real
  — the password is checked against a PBKDF2-HMAC-SHA256 hash — but the password
  itself crosses the network unencrypted, because there is no encrypted channel
  to carry it. It protects against someone who has the flash image, not against
  someone watching the wire.
- **Put the device on a trusted network segment.** OPC-UA on this target is for a
  controlled plant network behind a firewall, not an exposed one.

### Password iteration counts

The editor hashes passwords at 600,000 PBKDF2 iterations, which is right for a
Linux runtime. On this part PBKDF2 costs ~124 us per iteration, and the OPC-UA
library verifies a password synchronously, inside one scan — so 600,000
iterations would mean **74 seconds of stopped PLC** on every login attempt, which
any client knowing a username could trigger.

The runtime therefore **refuses** a hash demanding more than
`OPCUA_KDF_MAX_ITERATIONS` (default 20,000, ~2.5 s) and logs why. Keep the hash
at or below that for this target. Anonymous access is unaffected.

A project that declares any user refuses anonymous connections; a project that
declares none allows them.

## Costs nothing when unused

A project with no OPC-UA server configured compiles with the entire server
absent — measured 55,656 B flash / 103,788 B RAM, identical to a build from
before OPC-UA existed. There is no idle cost to leaving the feature available on
a target that does not use it.
