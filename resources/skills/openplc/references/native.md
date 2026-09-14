# Python and C/C++ POUs

Both carry their source as text, exactly like ST. The POU's `variables` are its
IEC interface — the pins other POUs wire to — and the body is the implementation.

```json
{
  "name": "Sampler",
  "kind": "function-block",
  "language": "cpp",
  "variables": [{ "name": "Trigger", "class": "input", "type": { "definition": "base-type", "value": "BOOL" } }],
  "body": { "text": "void setup() {}\nvoid loop() {}\n" }
}
```

The two languages differ in the one way that matters most:

|         | C/C++                   | Python                           |
| ------- | ----------------------- | -------------------------------- |
| Runs    | **inside** the PLC scan | in its own **process**           |
| Cadence | every scan              | ~100 ms, independent of the scan |
| A crash | takes the scan with it  | does not stop the PLC            |

So put anything timing-critical in C/C++ or an IEC language, and use Python for
work with no timing constraint.

## C/C++

**A body needs `void setup()` and `void loop()`.** `apply` refuses a body missing
either, and `check` reports it too.

- `setup()` runs exactly once, on the first scan after the PLC starts.
- `loop()` runs on every scan after that.

Local state that must survive between scans is an ordinary C++ variable at file
scope — it does NOT go in `variables`, which is only the IEC interface.

## Python

**A Python POU is a Function Block.** The editor offers no other type, so use
`"kind": "function-block"` and call it from an IEC POU. (`apply` does not
currently refuse `program` or `function`, but nothing in the editor makes one.)

**A body must define `block_init()` and `block_loop()`.** `apply` refuses one
that does not. A human gets both from the editor's template; a POU authored from
a spec never sees that template, and bare top-level statements run once at import
and then never again — the block would compile, upload, and do nothing.

- `block_init()` runs exactly once, when the Python process starts.
- `block_loop()` runs about every 100 ms. Not configurable. Measured at 100 ms on
  a Runtime v4 (152 loops in 15.2 s).

**Keep the four template imports**, even though your code appears not to use
them — the generated wrapper uses all four and does not import them itself:

```python
from multiprocessing import shared_memory
import struct
import time
import os
```

Dropping one fails in a way that sends you to the wrong place: the block exits
after about a second and the log says `[Python] PLC runtime has stopped.` The
runtime has not stopped — the wrapper's liveness check calls
`os.kill(plc_pid, 0)` and raises `NameError` because `os` was never imported. If
you see that message while the PLC is plainly running, check the imports first.

### The one hard rule: `block_loop()` must return

Inputs are refreshed before each call and outputs are sent back after it. A
`block_loop()` that never returns stops exchanging data with the PLC entirely.

Blocking work (network, file I/O, `time.sleep`) is otherwise fine — it delays
only your block, not the scan. For something genuinely long-running, start a
thread in `block_init()` and let `block_loop()` return, guarding any Variables
Table value the thread touches with a `threading.Lock` (those values are
refreshed every cycle).

### Pins

Pins are module globals, named exactly as `variables` declares them. Reads need
nothing; assigning an output needs `global`, which is Python's own rule:

```python
from multiprocessing import shared_memory
import struct
import time
import os

def block_init():
    global Peak
    Peak = 0

def block_loop():
    global Peak
    if Clear:
        Peak = 0
    elif Sample > Peak:
        Peak = Sample
```

Which classes cross, and which are refused:

| `class`                       | In a Python block                                  |
| ----------------------------- | -------------------------------------------------- |
| `input`, `inOut`, `external`  | sent in each cycle                                 |
| `output`, `inOut`, `external` | sent back each cycle                               |
| `local`                       | crosses BOTH ways — it is not private to the block |
| `temp`                        | **refused.** Use `local` instead                   |

`apply`'s own schema accepts `temp`; the compiler is what rejects it, with
"VAR_TEMP has no meaning in a Python block — its variables are module globals in
a process that outlives the scan."

Constraints worth knowing before you write a body:

- **Assigning to an INPUT does nothing.** The next cycle overwrites it.
- **`STRING` is capped at 126 characters** on the way back to the PLC.
- **Arrays keep their declared length and their IEC indices**, lower bound
  included — no `append`/`pop`.
- **`TIME`, `TOD` and `DT` arrive as integer nanoseconds.** `T#5s` is
  `5_000_000_000`.
- Structures, enumerations and arrays all cross; see the vendor page below.

### Reading a global from Python is safe; accumulating into one is not

A Python block can declare a `VAR_EXTERNAL` and reach a configuration global, but
because the block runs in another process the read and the write happen a cycle
apart. The PLC sends the value in with your inputs and stores your copy back
afterwards; anything that writes that global in between is lost.

```python
def block_loop():
    global shared_count
    shared_count = shared_count + 1   # NOT safe if anything else writes it
```

The same line is atomic in ST, LD, FBD, IL and C++, because those run inside the
scan under the global's lock. So:

- **Give every global a single writer.** That case is exact.
- **Read freely** — you may get a value one cycle old, never a corrupt one.
- **Never accumulate into a shared global from Python.** Have each writer own a
  variable and let an ST block add them up, where the addition is atomic.
- **Never use a global as a lock or semaphore** across the boundary.

### Function block instances

A Python block may declare an instance (`ton0 : TON`) and use its pins — but it
must not _call_ it. The instance lives in the PLC's process, and the PLC calls it
once per scan on your behalf.

```python
def block_loop():
    global elapsed, finished
    ton0.IN = start_signal
    ton0.PT = 5_000_000_000     # T#5s in nanoseconds
    finished = ton0.Q           # the PREVIOUS cycle's value
    elapsed = ton0.ET
```

- Pin names are **upper-cased** (`ton0.IN`, not `ton0.in`).
- Inputs and in-outs are read/write; **outputs are read-only**; internal state is
  not exposed.
- **Outputs are one cycle behind.** Setting a pin and reading a pin on adjacent
  lines looks synchronous and is not. If that matters, use an ST block.
- An **array of instances** and a **generic pin** (`ANY_NUM` and friends) are
  both refused.

### Libraries

The full Python 3 standard library is always available. Third-party packages are
whatever is `pip install`ed **on the target device**, so a project can work on one
device and fail to import on another. A block cannot install its own
dependencies, and cannot import other `.py` files from the project.

## Targets

Python blocks run on targets that embed an interpreter — the OpenPLC Runtime, and
the Simulator, which stubs them. **An arduino-cli board rejects them**, and
`check` says so when you name such a target rather than letting the board's C++
toolchain fail confusingly later.

## Checking

`check` runs the same preparation a build does, so a native POU is validated the
way the compiler would validate it. Use it before every compile.

## Source

The execution model, constraints and type mappings above are the editor's
documented behaviour:

- <https://edge.autonomylogic.com/docs/openplc-editor/custom-languages/python-blocks/python-basics>
- <https://edge.autonomylogic.com/docs/openplc-editor/custom-languages/python-blocks/python-restrictions>
- <https://edge.autonomylogic.com/docs/openplc-editor/custom-languages/python-blocks/python-data-types>
- <https://edge.autonomylogic.com/docs/openplc-editor/custom-languages/cpp-blocks/cpp-structure>
