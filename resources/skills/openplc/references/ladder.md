# Ladder bodies

```json
"body": { "rungs": [ { "comment": "...", "logic": {...}, "outputs": [...] } ] }
```

No coordinates. A rung is a series-parallel network, and the editor's own layout
solver places it.

## logic

Three forms, nestable:

```json
{ "contact": { "variable": "Start", "variant": "default" } }

{ "series": [ ..., ... ] }

{ "parallel": [ ..., ... ] }
```

`logic` is optional — omit it for a rung driven straight from the rail.

**Contact variants**, spelled exactly like this:

| `variant`     | Passes power when                 |
| ------------- | --------------------------------- |
| `default`     | the variable is TRUE (NO, `[ ]`)  |
| `negated`     | the variable is FALSE (NC, `[/]`) |
| `risingEdge`  | it goes FALSE → TRUE (`[P]`)      |
| `fallingEdge` | it goes TRUE → FALSE (`[N]`)      |

A `parallel` needs at least two branches. Three or more nest automatically.

## outputs

At least one. Either a coil:

```json
{ "coil": { "variable": "Run", "variant": "default" } }
```

**Coil variants:** the four contact variants plus `set` and `reset`.

| `variant`     | Does                                                    |
| ------------- | ------------------------------------------------------- |
| `default`     | writes the rung's power state (`( )`)                   |
| `negated`     | writes the inverse of it (`(/)`)                        |
| `set`         | TRUE when energised, otherwise leaves it alone (`(S)`)  |
| `reset`       | FALSE when energised, otherwise leaves it alone (`(R)`) |
| `risingEdge`  | TRUE for one scan on a rising power edge (`(P)`)        |
| `fallingEdge` | TRUE for one scan on a falling power edge (`(N)`)       |

`set` and `reset` are the latch/unlatch pair — use them together on one variable
rather than a `default` coil in two rungs, which is a double drive.

Or a block:

```json
{ "block": { "call": "system/iec-standard-fb/TON", "instance": "t0" } }
```

`instance` names a variable of that block's type, which the POU must declare
(`{ "definition": "derived", "value": "TON" }`).

### More than two branches

A parallel node pair brackets exactly two paths — one straight through, one
down — because that is what the node model carries. So `parallel` with three or
more entries is stored as nested pairs, and `describe` reports the nesting:

```
written:  { "parallel": [A, B, C] }
described: { "parallel": [A, { "parallel": [B, C] }] }
```

The two mean the same thing and apply identically. `describe` -> `apply` ->
`describe` is stable; only the first pass normalises the shorthand.

### How rung power reaches a block

By default power goes in the block's **first boolean input** and out its **first
boolean output** — `IN` and `Q` on a timer. That is what drives it, and it is how
the same rung is drawn by hand.

```json
{
  "logic": { "contact": { "variable": "Run", "variant": "default" } },
  "outputs": [
    {
      "block": {
        "call": "system/iec-standard-fb/TON",
        "instance": "holdOff",
        "inputs": { "PT": "HoldTime" },
        "outputs": { "ET": "Elapsed" }
      }
    },
    { "coil": { "variable": "Settled", "variant": "default" } }
  ]
}
```

Power drives `IN`, `Q` carries on to the coil, and `ET` is captured:

```
holdOff(IN := Run, PT := HoldTime);
Settled := holdOff.Q;
Elapsed := holdOff.ET;
```

`inputs` and `outputs` name the pins that are **not** carrying rung power. A
value in `inputs` is a variable name or a literal (`"100"`).

**`executionControl: true`** adds EN/ENO and runs power through those instead.
That only _gates the call_ — the block's own inputs stay open, so a timer wired
this way never times:

```
holdOff(EN := Run, PT := HoldTime);   (* IN is never assigned *)
Settled := holdOff.ENO;               (* ENO just mirrors EN *)
```

Use it only when you mean "run this block while the rung is true". The editor
turns it on by itself, and you cannot turn it off, for any block that has no
inputs, no outputs, a first input that is not BOOL, or a first output that is
not BOOL — `ADD` and most functions. `describe` reports it when it is on.

Either way, read the ST afterwards and confirm the block's inputs are assigned
and its outputs are read.

## Worked example

A start/stop seal-in with a rising-edge alarm:

```json
{
  "rungs": [
    {
      "comment": "Start/stop seal-in.",
      "logic": {
        "series": [
          {
            "parallel": [
              { "contact": { "variable": "Start", "variant": "default" } },
              { "contact": { "variable": "Run", "variant": "default" } }
            ]
          },
          { "contact": { "variable": "Stop", "variant": "negated" } }
        ]
      },
      "outputs": [{ "coil": { "variable": "Run", "variant": "default" } }]
    },
    {
      "comment": "Fault lamp.",
      "logic": { "contact": { "variable": "Run", "variant": "risingEdge" } },
      "outputs": [{ "coil": { "variable": "Fault", "variant": "set" } }]
    }
  ]
}
```

transpiles to

```
Run := NOT(Stop) AND (Run OR Start);
R_TRIG1(CLK := Run);
IF R_TRIG1.Q THEN
  Fault := TRUE; (*set*)
END_IF;
```

The `R_TRIG1` instance is declared for you — a `risingEdge` contact or coil adds
the edge-detect block it needs, so it is not in the POU's `variables`.
