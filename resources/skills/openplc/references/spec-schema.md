# The apply spec

One JSON document describing a whole project. Every object is strict: an
unrecognised key is an error naming its path.

```json
{
  "specVersion": 1,
  "device": { "board": "OpenPLC Runtime v4", "runtimeIpAddress": "localhost" },
  "libraries": [{ "name": "node-uio", "version": "0.0.1" }],
  "dataTypes": [],
  "globalVariableLists": [],
  "globalVariables": [],
  "pous": [],
  "tasks": [],
  "instances": []
}
```

## device

The build target. Not part of the project data proper — it is a separate file —
but it decides what the project compiles for, so set it rather than inheriting
whatever `create` chose.

| Field               | Notes                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board`             | Exactly as the editor names it, e.g. `OpenPLC Runtime v4` or `OpenPLC Simulator`. `describe` reports the one a project already uses; the editor's board picker has the full list. A name nothing recognises is NOT rejected — `check` and `compile` accept it and resolve whatever the scaffold chose, so a typo is silent. |
| `communicationPort` | Serial port, for a board flashed over USB.                                                                                                                                                                                                                                                                                  |
| `runtimeIpAddress`  | Address of a runtime target.                                                                                                                                                                                                                                                                                                |
| `persistentStorage` | `{ enabled, path?, flushSeconds? }` — where `retain` variables are kept. See below.                                                                                                                                                                                                                                         |

### device.persistentStorage

Delivered to the device as `retain.conf` with the program. Off by default, and a
project that leaves it off uploads no `retain.conf` at all — so a variable
flagged `retain` retains nothing until this is switched on.

| Field          | Notes                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | Required.                                                                                                                                                                                    |
| `path`         | Absolute path ON THE DEVICE. Empty or absent means the runtime's own default.                                                                                                                |
| `flushSeconds` | Commit period, 1-3600, default 5. The runtime is handed the blob every scan; this is what stops it writing at scan rate. Lower loses less state on a power cut and works the storage harder. |

## libraries

Libraries the project compiles against, pinned by version. Replaces the list
wholesale.

## globalVariableLists

A named group of globals whose members are reached as `List.Member`, with nothing
declared in the POU that uses them.

```json
{
  "name": "Plant",
  "qualifier": "CONSTANT",
  "variables": [{ "name": "MaxRpm", "type": { "definition": "base-type", "value": "INT" }, "initialValue": "1500" }]
}
```

A POU referring to `Plant.MaxRpm` gets its `VAR_EXTERNAL` automatically — the
generated ST declares `Plant : Plant_TYPE`. A list occupies TWO names: its own,
and `<name>_TYPE` for the struct behind it, so neither is available for anything
else.

**`qualifier` is stored but NOT applied at build time.** It records the modifier
that follows `VAR_GLOBAL` in the declaration and survives a round trip, but it
does not make the members constant or retained. Setting `"RETAIN"` here retains
nothing. For a variable that must actually be constant or retained, declare it in
a POU or in `globalVariables` and set its `flag` there.

Use `globalVariables` rather than a list when the variable needs a physical
`location`, a retention flag, or exposure to a Modbus / OPC-UA / S7comm server.

Every top-level section is optional except `specVersion`, which must be `1`. An
absent section is not a request to delete: `--prune` only removes entities
within sections the document declares.

## pous[]

| Field           | Notes                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| `name`          | Checked against every other element AND every installed library block.                     |
| `kind`          | `program` \| `function` \| `function-block`                                                |
| `language`      | `st` \| `il` \| `ld` \| `fbd` \| `python` \| `cpp`. Fixed once the POU exists — see below. |
| `returnType`    | Functions only.                                                                            |
| `documentation` | Optional.                                                                                  |
| `variables[]`   | See below.                                                                                 |
| `body`          | Shape depends on `language`.                                                               |

### Which kind, and what each one needs

| `kind`           | Languages                        | Notes                                                                                              |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `program`        | `st`, `il`, `ld`, `fbd`          | Top-level. Bound to a task by an `instance`. Keeps state between scans. May carry I/O `location`s. |
| `function`       | `st`, `il`, `ld`, `fbd`          | Stateless — locals are a fresh frame per call. Needs `returnType`.                                 |
| `function-block` | those four, plus `python`, `cpp` | Stateful. Instantiated as a variable with `definition: "derived"`.                                 |

`python` and `cpp` POUs are Function Blocks; the editor offers no other kind for
them. `apply` does not currently refuse `program` or `function` there, but
nothing in the editor produces one.

**A function returns by assigning to its own name**, which is the IEC
convention — there is no `RETURN value`:

```json
{
  "name": "CelsiusToF",
  "kind": "function",
  "language": "st",
  "returnType": "REAL",
  "variables": [{ "name": "TempC", "class": "input", "type": { "definition": "base-type", "value": "REAL" } }],
  "body": { "text": "CelsiusToF := TempC * 1.8 + 32.0;\n" }
}
```

**Always set `returnType` on a function.** Omitted, it silently becomes `BOOL` —
the POU still applies and compiles, so the mistake shows up as a type error at
the call site instead.

**A POU's language is fixed once it exists.** The body is stored in a file named
for the language (`Pump.st`, `Pump.ld`, `Pump.fbd`), so changing it would leave
the old file behind and the project would load that one instead. `apply` refuses
the change and says so; to switch languages, remove the POU and declare a new
one (`--prune` removes a POU the document stops mentioning).

## variables[]

| Field                           | Notes                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                          | May be auto-renamed if taken — read the change list.                                                                                                                                                |
| `class`                         | `input` \| `output` \| `inOut` \| `local` \| `temp` \| `external` \| `global`. Optional; defaults to `local` on a POU, `global` on the resource.                                                    |
| `type`                          | `{ "definition": ..., "value": ... }`                                                                                                                                                               |
| `location`                      | An alias name or a literal IEC address (`%IX0.0`).                                                                                                                                                  |
| `initialValue`, `documentation` | Optional.                                                                                                                                                                                           |
| `debug`                         | Optional. Ticks the variable into the EDITOR's debugger chart. `debug read` does not need it — the CLI reads anything in the debug map.                                                             |
| `flag`                          | `constant` \| `retain`. The variables table's **Flags** column. Absent is a plain `VAR` (IEC `NON_RETAIN`). Mutually exclusive, hence one field. `retain` needs `device.persistentStorage.enabled`. |

### Choosing a class

| You want                                | Use                                                                   |
| --------------------------------------- | --------------------------------------------------------------------- |
| State a POU remembers between scans     | `local` — the default                                                 |
| A Program to read or drive physical I/O | `local` **with a `location`** (`%IX0.0`). Still `local`.              |
| A pin on a function block or function   | `input` / `output` / `inOut`                                          |
| One value shared across POUs            | `global` on the resource + `external` in each POU, same name and type |
| A scratch value that must not persist   | `temp` — reset to its initial value every scan                        |

Two things that catch people out: a **Function's** locals are a fresh frame on
every call and never persist, unlike a Program's or a Function Block's; and
`temp` is refused outright in a Python POU (see `references/native.md`).

`type.definition` is one of `base-type` (`BOOL`, `INT`, `REAL`, `TIME`, …),
`user-data-type` (a type this project declares), `derived` (a function block
type, e.g. `TON`), `array`, or `generic-type`.

### An array variable

`definition: "array"` needs `dimensions`, and `value` is the **element** type —
not the rendered `ARRAY […] OF …`, which `apply` derives:

```json
{ "name": "Buf",  "type": { "definition": "array", "value": "INT",  "dimensions": ["0..3"] } }
{ "name": "Grid", "type": { "definition": "array", "value": "REAL", "dimensions": ["0..3", "0..2"] } }
```

The element may be a base type or a type this project declares. An array without
`dimensions`, or `dimensions` on a non-array, is refused.

The alternative is an array **data type** (below) used as a variable's
`user-data-type` — worth it when several variables share the shape.

A function block instance is an ordinary variable with `definition: "derived"`
and the block's name as its `value`.

## dataTypes[]

Every name a data type introduces — its own, each structure field, each
enumerated value — must be a legal IEC identifier. `apply` refuses a reserved
word (`Label`, `While`, …) or illegal characters, because a `.dt` written with
one fails to parse on the next load: the editor preserves the file and warns,
but the type is absent from the project and every reference to it then fails to
compile as an undefined type.

A structure field may itself be an array — give it `dimensions` exactly as a
variable would.

Three shapes, discriminated by `derivation`:

```json
{ "name": "Mode", "derivation": "enumerated", "values": ["IDLE", "RUN"], "initialValue": "IDLE" }

{ "name": "Motor", "derivation": "structure",
  "variables": [ { "name": "Speed", "type": { "definition": "base-type", "value": "INT" } } ] }

{ "name": "Bank", "derivation": "array",
  "baseType": { "definition": "base-type", "value": "INT" },
  "dimensions": ["0..9"] }
```

## tasks[] and instances[]

```json
{ "name": "Fast", "triggering": "Cyclic", "interval": "T#20ms", "priority": 0 }
{ "name": "inst0", "program": "main", "task": "Fast" }
```

`triggering` is `Cyclic` or `Interrupt`; almost everything is cyclic.

`interval` is IEC duration syntax — `T#20ms`. A bare `20ms` produces a project
that will not compile.

**`priority` is 0-100 and LOWER means HIGHER priority.** 0 is the highest, 100
the lowest; when two tasks come due in the same instant the lower number runs
first. Leave it at 0 unless you have several tasks and a reason.

An instance's `program` must name a POU of kind `program`; `apply` refuses a
dangling reference rather than letting it surface as a compile error later.

## Order

`apply` handles ordering itself — data types, POUs, bodies, variables, tasks,
then instances — so the document can list things in any order.
