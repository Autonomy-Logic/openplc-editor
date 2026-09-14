# Protocols

A project reaches the outside world through **servers** (things that listen on
this PLC) and **remote devices** (things this PLC talks to). Both are sections of
the `apply` spec, and `describe` emits them back in the same shape.

```json
{
  "specVersion": 1,
  "servers": [{ "name": "PlantModbus", "protocol": "modbus-tcp", "enabled": true }],
  "remoteDevices": [{ "name": "FieldIO", "protocol": "modbus-tcp", "modbus": { "host": "10.0.0.5" } }]
}
```

## The one thing to know first

**The runtime decides which protocol plugins to load from which
`conf/*.json` files the upload carries.** There is no endpoint that reports
which protocols are on, and no way to read a configuration back off a device. So
before uploading, ask the build:

```sh
openplc-cli check ./project --protocols
```

It runs the same generators the upload runs and prints the exact file set, which
_is_ the enable state. Pair it with `--lint` and it also reports the
configurations that would save, upload and then do nothing.

## Servers

One `enabled` per server. Stored, the flag lives somewhere different for each
protocol; in a spec there is one place for it and the normalizer puts it where
that protocol reads it. Absent means off, the same default the editor uses.

| `protocol`   | Config key | `enabled: false` means                                                 |
| ------------ | ---------- | ---------------------------------------------------------------------- |
| `modbus-tcp` | `modbus`   | no `conf/modbus_slave.json` — the plugin never starts, port closed     |
| `s7comm`     | `s7comm`   | the conf **still ships**; the plugin reads the flag and does not serve |
| `opcua`      | `opcua`    | no `conf/opcua.json`                                                   |

`ethernet-ip` is refused: the editor stores it but nothing generates a config
for it.

Everything below the name is optional and merges onto the same defaults the
editor seeds. A whole Modbus server is two lines:

```json
{ "name": "PlantModbus", "protocol": "modbus-tcp", "enabled": true }
```

### Modbus slave

```json
{
  "name": "PlantModbus",
  "protocol": "modbus-tcp",
  "enabled": true,
  "modbus": {
    "networkInterface": "0.0.0.0",
    "port": 502,
    "bufferMapping": { "coils": { "qxBits": 256 }, "holdingRegisters": { "qwCount": 64 } }
  }
}
```

`bufferMapping` is a window onto the PLC's own image, and every count it omits
takes the runtime default.

**Within each Modbus block the configured IEC segments are laid out
sequentially from address 0 of that block**, sized in that block's addressable
unit — bits for coils and discrete inputs, 16-bit registers for the register
blocks. Bit addresses are `byte.bit`, so coil 8 rolls over to `%QX1.0`.

| Block                      | Segments, in order                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Coils (FC 1/5/15)          | `qxBits` of `%QX`, then `mxBits` of `%MX`                                                                                         |
| Discrete inputs (FC 2)     | `ixBits` of `%IX` (max 8192)                                                                                                      |
| Holding registers (3/6/16) | `qwCount` of `%QW`, then `mwCount` of `%MW`, then `mdCount` of `%MD` (**2 registers each**), then `mlCount` of `%ML` (**4 each**) |
| Input registers (FC 4)     | `iwCount` of `%IW` (max 1024)                                                                                                     |

So with the defaults, coil 80 is `%QX10.0` and holding register 10 is `%QW10` —
but only while those indices fall inside the FIRST segment. Past `qxBits` the
coils become `%MX`, and past `qwCount` the registers become `%MW`, then `%MD`,
then `%ML`. Size the segment to cover the address you want before assuming it.

**`%QD`, `%QB`, `%ID`, `%IB`, `%QL` and `%IL` are not reachable over Modbus at
all** — the protocol indexes no separate byte/double/long output or input
segment. Copy the value into a `%MD`/`%MW` in your program, or use S7comm, which
maps all fourteen PLC-memory variants directly.

A variable outside the window is simply not served, with no error anywhere. The
Modbus Server screen's **Address Mapping Reference** computes the full table from
the project's current sizes and is the source of truth when they are not default.

Many off-the-shelf clients number coils 1-based, so coil 1 in the tool is coil 0
on the wire.

Only one Modbus server can be enabled: the runtime takes one config per
protocol. A second is reported by `check --lint`, not silently dropped.

### S7comm

```json
{
  "name": "PlantS7",
  "protocol": "s7comm",
  "enabled": true,
  "s7comm": {
    "server": { "bindAddress": "0.0.0.0", "port": 102, "maxClients": 8 },
    "plcIdentity": { "name": "Line 4" },
    "dataBlocks": [
      {
        "dbNumber": 1,
        "description": "Level",
        "sizeBytes": 64,
        "mapping": { "type": "int_output", "startBuffer": 0, "bitAddressing": false }
      }
    ]
  }
}
```

A data block is a window like the Modbus buffer mapping: `int_output` with
`startBuffer: 0` makes DB1 word _N_ equal `%QW N`; `bool_output` with
`bitAddressing` makes DB*n* byte _N_ bit _B_ equal `%QX N.B`. `sizeBytes` has to
be large enough to reach the address you care about — 32 bytes to see `%QX10.0`.

### OPC UA

```json
{
  "name": "PlantOpcUa",
  "protocol": "opcua",
  "enabled": true,
  "opcua": {
    "server": { "bindAddress": "0.0.0.0", "port": 4840, "endpointPath": "/openplc/opcua" },
    "securityProfiles": [
      {
        "name": "insecure",
        "enabled": true,
        "securityPolicy": "None",
        "securityMode": "None",
        "authMethods": ["Anonymous", "Username"]
      }
    ],
    "users": [
      {
        "type": "password",
        "username": "operator",
        "passwordHash": "$2b$12$…",
        "certificateId": null,
        "role": "operator"
      }
    ],
    "addressSpace": {
      "nodes": [
        {
          "pouName": "PlantLogic",
          "variablePath": "levelPct",
          "variableType": "INT",
          "nodeId": "PLC.PlantLogic.levelPct",
          "browseName": "levelPct",
          "displayName": "Level percent",
          "description": "",
          "permissions": { "viewer": "r", "operator": "rw", "engineer": "rw" },
          "nodeType": "variable"
        }
      ]
    }
  }
}
```

Five things that are easy to get wrong:

- **`nodeId` is the identifier, not a node id.** The server adds its own
  namespace, so `PLC.PlantLogic.levelPct` becomes
  `ns=2;s=PLC.PlantLogic.levelPct`. Writing `ns=1;s=…` produces
  `ns=2;s=ns=1;s=…`, which browses but cannot be read by the id you wrote.
  `check --lint` reports it. Use the editor's own form, `PLC.<POU>.<path>`, so a
  CLI-authored server matches a hand-authored one. Max 128 characters, and it
  must be unique across every exposed node.
- **`pouName` must be an instantiated program.** A node naming a resource global
  or an uninstantiated POU cannot resolve; `check --lint` catches it before upload,
  through the generator's own validator against the debug map.
- **Permissions are enforced.** An anonymous client is a `viewer`, so a node with
  `viewer: "r"` refuses its writes. Allow `Username` on a profile and give the
  user `operator` or `engineer` to write.
- **Omitting `securityProfiles` leaves the server open.** The shipped default is
  one enabled `None`/`None` Anonymous profile. In the editor that is harmless
  because a new server starts disabled; a spec saying `enabled: true` without
  naming a profile inherits it and serves `0.0.0.0:4840` to any client that can
  reach it. `check --lint` warns (`opcua-server-unauthenticated`). Name a profile
  with a policy and an auth method, or bind the server to one interface.
- **Secrets are redacted by `describe` and preserved by `apply`.**
  `security.serverPrivateKeyCustom` and every `users[].passwordHash` are left out
  of `describe` output; applying a spec that omits them keeps what is stored.
  To change one, write it.

## Remote devices

| `protocol`   | Config key | Notes                                        |
| ------------ | ---------- | -------------------------------------------- |
| `modbus-tcp` | `modbus`   | TCP or RTU, by `transport`                   |
| `ethercat`   | `ethercat` | a master plus slaves authored from ESI files |

`ethernet-ip` and `profinet` are refused: the editor stores them, nothing
generates a config.

### Modbus master

```json
{
  "name": "FieldIO",
  "protocol": "modbus-tcp",
  "modbus": {
    "transport": "tcp",
    "host": "10.0.0.5",
    "port": 502,
    "slaveId": 1,
    "timeout": 1000,
    "ioGroups": [
      {
        "name": "Inputs",
        "functionCode": "2",
        "cycleTime": 100,
        "offset": "0x0000",
        "length": 8,
        "aliases": ["fStart", "fStop"]
      }
    ]
  }
}
```

**Name the points you want to read.** A group's points are allocated an IEC
address by the editor, and `aliases` names them in order. A program reaches a
polled value by putting the alias in a global's `location`:

```json
{
  "name": "fieldStart",
  "class": "global",
  "type": { "definition": "base-type", "value": "BOOL" },
  "location": "fStart"
}
```

**Give the variable a different name from the alias.** Variables and aliases share
one namespace, so a global named `fStart` bound to the alias `fStart` is refused.
It only collides once the alias exists, so the same spec applied to an empty
project appears to work and then fails the day a variable is added to a project
that already has the device. `apply` reports it rather than renaming around it.

Without an alias the point has an address and no name, and nothing can read it.
Bind by alias rather than by writing the address yourself — the allocator does
not know about hand-written addresses and will hand the same one to a device,
which then overwrites the global every poll. `check --lint` reports that
collision.

`describe` lists what each point actually got under a sibling `protocolAddresses`
key, outside `spec` — allocation decides those, so they are a report, not an input.

Two shapes the generator drops without failing the compile, both refused here
instead: a device with no I/O groups, and RTU with no `serialPort`. Slave ids are
0–255 over TCP and 1–247 over RTU.

### EtherCAT

Import the vendor's ESI file first:

```sh
openplc-cli esi import ./EL7041.xml --project ./project
openplc-cli esi list --project ./project          # ids and device indices
```

Then declare the bus. A slave is an ESI reference plus overrides — its channels,
PDOs, SDOs, CiA 402 block and IEC addresses are all read out of the file:

```json
{
  "name": "MotionBus",
  "protocol": "ethercat",
  "ethercat": {
    "master": { "enabled": true, "networkInterface": "eth0", "cycleTimeUs": 1000 },
    "slaves": [
      {
        "esiDeviceRef": { "repositoryItemId": "EL7041.xml", "deviceIndex": 0 },
        "name": "Axis1",
        "position": 0,
        "config": { "addressing": { "ethercatAddress": 1001 } },
        "cia402": { "enabled": true, "scaleFactor": 1048576 },
        "aliases": { "0x1A00-0x6041-0x0": "AxisStatus" }
      }
    ]
  }
}
```

Master fields and their ranges: `cycleTimeUs` 100–100000 (default 1000),
`watchdogTimeoutCycles` 1–100 (default 3), `taskPriority` 1–31.

**Set `taskPriority` explicitly if you care about it.** The editor shows 1 as the
default but stores nothing when you leave it alone, and the config generator
falls back to **90** for an absent value — so a bus that looks like priority 1 in
the editor ships 90 to the runtime. Writing the number you want removes the
ambiguity. (This is upstream behaviour, not something the CLI introduces: a
GUI-authored bus does the same.)

`repositoryItemId` takes the file name or the id `esi import` printed. A slave
name becomes a SoftMotion axis variable when the drive is CiA 402, so it is made
a legal identifier. `conf/ethercat.json` is written only for a bus with an
enabled master and at least one slave.

## Renaming

A rename reads as a delete plus a create, so `apply --prune` is what removes the
old one. Without `--prune` both survive, and two enabled servers of one protocol
is an error `check --lint` reports.
