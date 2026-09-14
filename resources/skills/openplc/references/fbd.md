# FBD bodies

```json
"body": { "nodes": [...], "connections": [...] }
```

No coordinates. Nodes are placed by signal flow — each sits to the right of
everything feeding it.

## nodes[]

| Field      | Notes                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| `label`    | Your name for the node, used only inside this document.                           |
| `kind`     | `block` \| `input-variable` \| `output-variable` \| `inout-variable` \| `comment` |
| `call`     | Blocks only: `system/<library>/<block>` or `user/<pou>`.                          |
| `instance` | Blocks only: the instance variable's name.                                        |
| `variable` | Variable nodes: the variable's name.                                              |
| `text`     | Comments only.                                                                    |

Get `call` from `describe --libraries`, which prints it ready to paste.

## connections[]

```json
{ "from": "inCmd", "to": "timer.IN" }
```

`from` and `to` are a `label`, or `label.PIN` for a block. **`PIN` is the pin's
name exactly as the library declares it** — `IN`, `PT`, `Q`, `ET`. A variable
node needs no pin; its direction settles it.

**Feedback loops are refused.** FBD is a left-to-right data flow, and a diagram
cannot feed a block from something downstream of it. To carry a value back, write
it to a variable and read that variable — a variable holds its value to the next
scan, which is what a feedback path actually needs. `apply` names the two nodes
involved.

## Worked example

```json
{
  "nodes": [
    { "label": "inCmd", "kind": "input-variable", "variable": "Cmd" },
    { "label": "inPT", "kind": "input-variable", "variable": "Delay" },
    { "label": "timer", "kind": "block", "call": "system/iec-standard-fb/TON", "instance": "t0" },
    { "label": "outQ", "kind": "output-variable", "variable": "Held" }
  ],
  "connections": [
    { "from": "inCmd", "to": "timer.IN" },
    { "from": "inPT", "to": "timer.PT" },
    { "from": "timer.Q", "to": "outQ" }
  ]
}
```

transpiles to

```
t0(IN := Cmd, PT := Delay);
Held := t0.Q;
```

## executionOrder and executionControl

Both are block-only and both are optional.

`executionOrder` is the number the Block Properties dialog sets — the order
blocks are evaluated in. Leave it out (or 0) and the block is unordered, which is
what you want unless a data dependency is ambiguous.

`executionControl: true` adds EN/ENO so the block's execution can be gated by a
wire. Unlike ladder there is no rung power here, so every pin is wired
explicitly and EN is just another input.

Also unlike ladder, FBD never adds EN/ENO on its own: omit the flag and the pins
are removed, whatever the block's first input and output types are. The forcing
rule in `references/ladder.md` is a ladder rule only — it exists because a rung
has to enter the block somewhere, and FBD has no rung. `describe` reports the
flag when it is on.
