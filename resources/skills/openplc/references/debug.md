# Debugging

A debug session is long-lived; each command is a one-shot that attaches to it.

```sh
openplc-cli debug open <project> --target <board> (--host <address> | --port <serial>)
openplc-cli debug list
openplc-cli debug list-vars
openplc-cli debug read --session <id>
openplc-cli debug force <variable> <value>
openplc-cli debug unforce <variable>
openplc-cli debug start | stop
openplc-cli debug watch | poll | unwatch
openplc-cli debug close --session <id> | --all
```

`debug open` returns a `session_id`. A session closes itself after 30 minutes
idle.

`debug read` and `force` reach any variable in the program's debug map —
`debug list-vars` prints the whole list. A variable's `debug: true` flag ticks it
into the EDITOR's chart and is not needed here.

Paths use a colon between the POU and the variable: `PlantLogic:levelPct`, and
`Config0:gPump` for a resource global. Members and array elements use dots and
brackets from there — `AnalogChain:counter.Cfg.Trend[0]`.

## Credentials

Targets reached over a runtime API need them; a board flashed over USB does not.

```sh
--credentials user:pass          # or --user / --password
OPENPLC_CREDENTIALS=user:pass    # or OPENPLC_USER + OPENPLC_PASSWORD
```

Prefer the environment form: a flag lands in shell history and job logs.

See `docs/CLI.md` in the editor repository for the session protocol and the full
flag list.

## Forcing an enumerated variable does not take

Reading one works. Forcing one is accepted, reads back as forced, and the
program never sees the new value — verified on three members of one structure:

| member      | type       | forced | seen by the program |
| ----------- | ---------- | ------ | ------------------- |
| `Cfg.Id`    | INT        | 99     | 99                  |
| `Cfg.Speed` | REAL       | 3.25   | 3.25                |
| `Cfg.Mode`  | enumerated | 2      | 0                   |

The cause is in the debug map, which STruC++ generates: an enumerated variable
is published as `INT` of 2 bytes while the generated C++ declares
`enum class` (4 bytes). Reads survive that on a little-endian target for small
ordinals; a write does not land.

So drive an enum from logic, or from a plain INT you force, rather than by
forcing the enum itself.
