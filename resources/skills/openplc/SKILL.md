---
name: openplc
description: Author, check, compile, upload and debug OpenPLC projects from the command line. Use when creating or editing PLC logic (POUs, variables, data types, Ladder, FBD, Structured Text, IL, Python, C/C++) in an OpenPLC project.
---

# OpenPLC projects from the command line

`openplc-cli` ships inside the OpenPLC Editor. It can read a project, author
one, check it in about a second, then compile, upload and debug against real
hardware.

Run `openplc-cli --help` for the full surface. Everything below is the loop that
matters.

## The loop

```
describe -> edit -> apply --dry-run -> apply -> check --emit-st -> READ THE ST -> compile
```

1. **`describe <project> --json`** — read the project as a spec document.
2. Edit that document.
3. **`apply <spec.json> --project <dir> --dry-run`** — validate and list the
   changes without writing.
4. **`apply <spec.json> --project <dir>`** — write them.
5. **`check <project> --lint --emit-st`** — transpile, run the real compiler's
   semantic pass, and check the logic actually does something. Seconds, no
   toolchain. **Always pass `--lint`.**
6. **Read the ST it emits and confirm it is the logic you meant.** The linter
   catches the common failures; it cannot know what you intended.
7. **`compile <project> --target <board>`** — the real build.

Before uploading to a device you have not used before, ask what it is:
**`runtime info --host <address>`** needs no login and reports the runtime
version and what it supports — notably whether `flag: "retain"` will actually
retain. Everything else that talks to a device changes it.

## `check --lint`

`check` alone answers "does this compile". A timer nothing drives, a coil two
rungs write, a program touching no I/O — all compile. `--lint` reads the
generated ST and reports them:

| rule                             | severity | means                                                                                                                           |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `block-primary-input-unassigned` | error    | The block is called but its first input is never assigned, so it does nothing. Usually the EN/ENO trap.                         |
| `variable-driven-twice`          | error    | Two unconditional statements write it; only the last survives. A double coil. A SET/RESET pair is not this and is not reported. |
| `no-io-referenced`               | error    | No POU references any global bound to an IEC address — the program reads no inputs and drives no outputs.                       |
| `block-outputs-unread`           | warning  | Nothing reads any output of the block; its result goes nowhere.                                                                 |
| `located-global-unreferenced`    | warning  | A global is bound to an address but no POU uses it.                                                                             |

`--lint` also checks the protocol configuration, which has the same problem in a
different place — all of these save, upload and half-exist:

| rule                                     | severity | means                                                                                                        |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `duplicate-protocol-server`              | error    | Two enabled servers of one protocol; the runtime takes one config, so the second is dropped.                 |
| `server-port-conflict`                   | error    | Two enabled servers on one port.                                                                             |
| `modbus-device-without-io-groups`        | error    | The generator drops the device: it uploads cleanly and polls nothing.                                        |
| `modbus-rtu-without-serial-port`         | error    | Same, for an RTU device with no `serialPort`.                                                                |
| `located-global-collides-with-remote-io` | error    | A global's hand-written address was also handed to a device, which overwrites it every poll. Bind by alias.  |
| `opcua-config-invalid`                   | error    | The OPC-UA generator's own validator — usually a node naming a variable the program does not have.           |
| `opcua-node-id-is-an-identifier`         | error    | `nodeId` carries a whole node id; the server adds its own namespace, so the id you wrote is unreachable.     |
| `ethercat-config-invalid`                | error    | The EtherCAT config could not be generated or did not validate.                                              |
| `opcua-server-unauthenticated`           | warning  | An enabled server whose every enabled profile is None/None + Anonymous — open to any client that reaches it. |
| `modbus-rtu-serial-port-shared`          | warning  | Two RTU masters on one serial line.                                                                          |
| `ethercat-master-without-slaves`         | warning  | No config is generated for the bus.                                                                          |
| `ethercat-slave-without-channels`        | warning  | The slave exchanges no data.                                                                                 |

An error fails the command (exit 4); a warning does not. So `--lint` is safe to
leave on in a pipeline.

## Close the loop: read the ST you generated

A ladder or FBD body is a graph. You wrote the graph; the ST is what that graph
actually _means_. Those are not the same thing, and a body can draw correctly,
validate, and compile while doing nothing at all.

So after `check --emit-st`, read the ST for every graphical POU you touched and
confirm each one against what you intended. If it does not match, fix the spec
and go round again. This is the only check that catches wrong logic — the
diagram renders either way and the compiler is happy either way.

What to look for, all of which have happened:

- **A block whose input is never assigned.** `holdOff(EN := Run, PT := HoldTime)`
  with no `IN :=` is a timer that never runs. Rung power through EN/ENO only
  gates the call; it does not drive the block. See `references/ladder.md`.
- **A block output nothing reads.** If `.Q` never appears on the right of an
  assignment, the block's result is going nowhere.
- **The same variable assigned by two rungs.** The last one wins and the earlier
  rung is dead. Search the POU body for each coil name.
- **A variable read but never written**, or written but never read. Usually a
  rung wired to the wrong name.
- **Self-referencing nonsense** — `Permit := NOT(Permit) AND ...` oscillates
  every scan. Legal ST, useless logic.
- **Nothing touching the outside.** If no POU references a global bound to a
  `%IX`/`%QX` address, the program reads no inputs and drives no outputs
  whatever else it does.
- **Statement order.** Rungs execute top to bottom in one scan. A rung consuming
  a value a later rung produces is using last scan's value — sometimes intended,
  usually not.

## Before you author anything

**Read the block catalogue.** `describe <project> --libraries --json` lists every
installed block with its exact pin names and types, and a `call` string ready to
paste. Do not guess whether a timer's preset pin is `PT` or `PRESET` — look.

**Do not invent names.** A name is checked against every other element, every
block of every INSTALLED library, and the IEC reserved words. Installed, not
enabled: library symbols are declared on every build regardless of the project's
`libraries` list, so a name is taken whether or not you use that library. Real
collisions seen in practice: `Limit` and `Log` (functions in
`iec-std-functions`) and `Scale` (a block in `oscat-basic`). If `apply` refuses
a name, rename it — do not try to force it.

**Pin names must be exact.** `apply` refuses a pin the block does not have and
lists the ones it does, so a wrong guess is an error rather than a wire that
silently does nothing. `describe --libraries` gives you the real list.

## Writing a spec

One document describes the whole project. It is upsert-by-name and idempotent:
applying it twice leaves the same project. `--prune` deletes what the document
does not mention.

See `references/spec-schema.md` for every field. The schema is strict — a
misspelled key is an error naming the path, not a silently ignored field.

## Languages

| Language                    | Body                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `st`, `il`, `python`, `cpp` | `{ "text": "..." }` — verbatim                                       |
| `ld`                        | `{ "rungs": [...] }` — see `references/ladder.md`                    |
| `fbd`                       | `{ "nodes": [...], "connections": [...] }` — see `references/fbd.md` |
| `sfc`                       | Not supported by the transpiler. `apply` refuses it.                 |

Extensible blocks accept more inputs than they declare: wire the next `IN<n>`
and the block grows to fit. The catalogue's fifteen are `ADD`, `MUL`, `AND`,
`OR`, `XOR`, `MIN`, `MAX`, `CONCAT`, `EQ`, `NE`, `LT`, `LE`, `GT`, `GE` — all of
which declare `IN1`/`IN2`, so the next pin is `IN3` — and `MUX`, which declares
`K`, `IN0`, `IN1`, so its next pin is `IN2`. `describe --libraries` marks each
one `extensible`. Every other block rejects a pin it does not declare.

Generic pins (`ANY`, `ANY_NUM`, `ANY_REAL`) take their concrete type from what
you wire to them.

Python and C/C++ POUs carry their source as text. A C/C++ body needs `setup()`
and `loop()`; `check` reports it if they are missing.

## Retained variables

`flag: "retain"` on a variable keeps its value across a power cycle — the right
thing for a setpoint. Two rules:

**It does nothing on its own.** The project must also switch the store on:

```json
"device": { "persistentStorage": { "enabled": true, "flushSeconds": 5 } }
```

Without that the upload carries no `retain.conf` and the runtime's store stays
off, so a variable flagged `retain` retains nothing.

**Do not try to throttle the writes yourself.** The runtime already buffers: it
is handed the retained blob every scan and commits it on `flushSeconds`
(default 5, range 1-3600). That buffering is what keeps it from writing at scan
rate and wearing the flash out. Tune the period instead — lower loses less state
to a power cut and works the storage harder; higher is gentler. Adding your own
"only write when changed" guard in ladder or ST does not reduce flash writes,
because the commit is on a timer, not on your assignment.

`flag: "constant"` is the other qualifier; the two are mutually exclusive.

## Protocols

`servers` and `remoteDevices` connect the program to the outside world — Modbus
slave and master, S7comm, OPC-UA, EtherCAT. See `references/protocols.md`.

The rule worth knowing before you write any of it: **the runtime decides which
protocol plugins to load from which `conf/*.json` files the upload carries**, and
nothing reads a configuration back off a device. So check what would ship:

```sh
openplc-cli check ./project --lint --protocols
```

That runs the same generators the upload runs and prints the exact file set,
which _is_ the enable state — no device needed.

## Things that will catch you out

**Do not list a bundled library in `libraries`.** The blocks in
`additional-function-blocks`, `iec-standard-fb`, `iec-std-functions`,
`oscat-basic` and `plcopen-softmotion` are usable without declaring anything —
just `call` them. The `libraries` list is for libraries INSTALLED through the
Library Manager, which the build resolves to an archive on disk; a bundled library has no archive, so naming one there stops the
build with "enables libraries that are not installed". `apply` now refuses it
with that explanation, but the shape of the document invites the mistake.

**A pin name is per block, not per POU.** Three motion blocks can each declare
`POSITION`; `inputs` and `outputs` are read against the block they sit on.

**In-out pins are not optional.** SoftMotion blocks carry an `AXIS` pin of class
`inOut`; name it through `inputs` like any other. The compiler refuses a call
that leaves an in-out unassigned, so a missing `AXIS` is an error, not a default.
`describe --libraries` lists a pin's `class` — read it.

- **`check` is not optional.** It runs the same preparation a build does and
  then the compiler's semantic pass, so it catches undeclared variables, wrong
  pin names and type errors. A project that passes `check` usually compiles.
- **An instance references a task and a program by name and validates neither
  at creation.** `apply` checks them for you; a hand-edited `project.json` will
  not be checked until the build fails.
- **A task interval is IEC duration syntax** — `T#20ms`, not `20ms`.
- **A variable may be renamed under you.** Asking for a name that is taken gets
  you `Motor1`. `apply` reports it in the change list; read it.
- **Ladder and FBD bodies that `describe` cannot express** come back with
  `bodyLossy: true` and a reason. Do not re-apply such a POU — you would
  overwrite a diagram with an approximation of it.

## Output

JSON when stdout is not a terminal, human-readable when it is; `--json` /
`--no-json` override. Progress goes to stderr, so stdout carries exactly one
JSON document.

Exit codes: `0` ok, `2` usage, `3` not found, `4` compile or spec failed,
`5` connection, `6` auth, `7` target error, `8` timeout, `70` internal.

## Further reading

- `references/spec-schema.md` — every field of the apply spec
- `references/ladder.md` — rungs, series, parallels, coil variants
- `references/fbd.md` — nodes, pins, connections
- `references/native.md` — Python and C/C++ POUs
- `references/debug.md` — sessions, reading and forcing variables
- `references/protocols.md` — servers, remote devices, EtherCAT, and what each `enabled` does
