# Phase 4: Debugger

## Status: Design locked, ready to implement

## Goals

- Replace the flat `debug_vars[]` mechanism (MatIEC + xml2st) with a scalable scheme built
  on STruC++'s `IECVar<T>` forcing API.
- Work well for small embedded targets (~50 variables on Arduino Mega) **and** large
  Linux projects (50K+ variables on Runtime v4).
- Minimize rewrite of the editor's upper layers — the composite-key tree, polling loop,
  forcing UI, and Zustand store should remain effectively unchanged.
- Full leaf-level addressability: every array element and every struct/FB field is
  independently readable and forceable.

## Why the current design fails

The MatIEC pipeline generates `debug.c` containing a single `debug_vars[]` array with one
entry per **leaf** (arrays and structs expanded element-by-element). Real-world failure
mode observed on a user project:

```
src/debug.c:32926:1: error: size of array is too large
```

That project had ~33,000 leaves. AVR GCC's `size_t` is 16-bit, so a single object cannot
exceed 32,767 bytes — with a multi-field struct per entry the ceiling is hit well before
that element count. Moving metadata to Flash is necessary but not sufficient: the
*single-array* constraint itself is the blocker.

## Design summary

1. **Every leaf is expanded.** No runtime walking of composite variables — each array
   element and struct/FB field gets its own table entry.
2. **Multiple debug arrays.** STruC++ emits the table as a set of arrays, each capped
   at 8,000 entries (safe margin under AVR's 32,767-byte object limit, assuming 4 B/entry).
   On Linux the same split is used for consistency.
3. **Compact per-entry format.** `struct Entry { void* ptr; uint8_t type_tag; uint8_t _pad; }`
   = 4 bytes. Entry table lives in Flash (`PROGMEM` on AVR, `.rodata` on Linux). Zero SRAM
   cost.
4. **All C++ artifacts owned by STruC++.** Both the shared runtime headers (dispatch
   table, templated helpers) **and** the per-project generated code (`generated_debug.cpp`
   + `debug-map.json`) are emitted by STruC++. The editor is a pure consumer: it writes
   the files STruC++ returns from `compile()` to disk and reads `debug-map.json` for its
   own name→address lookups. This keeps layout-sensitive code colocated with the
   generator that produced it, so a STruC++ version bump can't desync runtime headers
   from compiler output.
5. **Agnostic runtime dispatcher.** A `TypeOps` table indexed by `type_tag` holds
   function pointers to `force_impl<T>`, `unforce_impl<T>`, `read_impl<T>` instantiated
   for each IEC elementary type. Covers all leaves because STruC++ wraps every leaf as
   `IECVar<T>` where T is an elementary type. No per-project dispatch code.
6. **Protocol addressing: `(array_idx: u8, elem_idx: u16)`.** 256 arrays × 65K entries =
   16M addressable leaves. More than enough for any realistic project.
7. **Two-stage rollout:** polling-based first (Modbus FCs 0x41–0x45 with the new PDU
   layout), subscription/stream later (0x46–0x48). Subscription is orthogonal to addressing
   and can ship as a follow-up without breaking the base protocol.

---

## What gets generated vs. what ships in the runtime

STruC++ owns every C++ artifact and the editor-side manifest. The editor's only job is
to persist them to disk and consume the manifest for name lookups.

`compile()` is extended to return two additional fields alongside `cppCode` /
`headerCode`:

```ts
interface CompileResult {
  // existing
  cppCode: string
  headerCode: string
  // new — Phase 4
  debugTableCpp: string   // contents for generated_debug.cpp
  debugMap: DebugMapV2    // path → (arrayIdx, elemIdx), serializable to JSON
  // ...
}
```

The editor's `strucpp-compiler.ts` wrapper writes `debugTableCpp` to
`<board>/src/generated_debug.cpp` and `JSON.stringify(debugMap)` to
`<board>/src/debug-map.json`. That's the entire editor side of the pipeline.

### Per-project artifacts (emitted by STruC++'s `compile()`)

**`generated_debug.cpp`** — pointer tables only:

```cpp
#include "generated.hpp"
#include "strucpp/debug_dispatch.hpp"

using namespace strucpp::debug;

// Each array caps at ~8000 entries to stay under AVR's 32767-byte single-object limit.
const Entry debug_arr_0[] STRUCPP_DEBUG_FLASH = {
    { (void*)&g_config.INSTANCE0.blink,     TAG_BOOL },
    { (void*)&g_config.INSTANCE0.counter,   TAG_INT  },
    { (void*)&g_config.INSTANCE0.speeds[0], TAG_INT  },
    { (void*)&g_config.INSTANCE0.speeds[1], TAG_INT  },
    // ...
};
const Entry debug_arr_1[] STRUCPP_DEBUG_FLASH = { /* next batch */ };

const Entry* const debug_arrays[]     STRUCPP_DEBUG_FLASH = { debug_arr_0, debug_arr_1 };
const uint16_t    debug_array_counts[] STRUCPP_DEBUG_FLASH = { 8000, 5231 };
const uint8_t     debug_array_count                        = 2;
```

`STRUCPP_DEBUG_FLASH` is defined in `debug_dispatch.hpp` — expands to `PROGMEM` on AVR,
empty elsewhere. This keeps the generated code target-neutral; the runtime header
decides placement.

**`debug-map.json`** — editor-consumed manifest, also emitted by STruC++:

```json
{
  "version": 2,
  "md5": "<of program.st + strucpp version>",
  "typeTags": {
    "BOOL": 0, "SINT": 1, "INT": 2, "DINT": 3, "LINT": 4,
    "REAL": 5, "LREAL": 6, "STRING": 7, "TIME": 8
  },
  "arrays": [
    { "index": 0, "count": 8000 },
    { "index": 1, "count": 5231 }
  ],
  "leaves": [
    { "arrayIdx": 0, "elemIdx": 0, "path": "INSTANCE0.blink",       "type": "BOOL", "size": 1 },
    { "arrayIdx": 0, "elemIdx": 1, "path": "INSTANCE0.counter",     "type": "INT",  "size": 2 },
    { "arrayIdx": 0, "elemIdx": 2, "path": "INSTANCE0.speeds[0]",   "type": "INT",  "size": 2 },
    { "arrayIdx": 0, "elemIdx": 3, "path": "INSTANCE0.speeds[1]",   "type": "INT",  "size": 2 }
  ]
}
```

Packing rule (implemented by the STruC++ codegen): emit leaves in declaration order,
flush to a new debug array when the current one reaches 8,000 entries **or** at a
program boundary (whichever comes first). Program-boundary flush isolates per-program
churn from downstream arrays.

### Shared across all projects (STruC++ runtime headers)

**`strucpp/debug_dispatch.hpp`** — the generic handler, unchanged across projects:

```cpp
// Flash-placement macro used by generated_debug.cpp
#ifdef __AVR__
#include <avr/pgmspace.h>
#define STRUCPP_DEBUG_FLASH PROGMEM
#else
#define STRUCPP_DEBUG_FLASH
#endif

namespace strucpp::debug {

enum TypeTag : uint8_t {
    TAG_BOOL = 0, TAG_SINT, TAG_USINT, TAG_INT, TAG_UINT,
    TAG_DINT, TAG_UDINT, TAG_LINT, TAG_ULINT,
    TAG_REAL, TAG_LREAL,
    TAG_BYTE, TAG_WORD, TAG_DWORD, TAG_LWORD,
    TAG_TIME, TAG_DATE, TAG_TOD, TAG_DT,
    TAG_STRING, TAG_WSTRING,
    TAG__COUNT
};

struct Entry { void* ptr; uint8_t tag; uint8_t _pad; };

template<typename T>
static void force_impl(void* p, const uint8_t* bytes) {
    T v; memcpy(&v, bytes, sizeof(T));
    static_cast<IECVar<T>*>(p)->force(v);
}
template<typename T>
static void unforce_impl(void* p) {
    static_cast<IECVar<T>*>(p)->unforce();
}
template<typename T>
static void read_impl(const void* p, uint8_t* dest) {
    T v = static_cast<const IECVar<T>*>(p)->get();
    memcpy(dest, &v, sizeof(T));
}

struct TypeOps {
    void (*force)  (void*, const uint8_t*);
    void (*unforce)(void*);
    void (*read)   (const void*, uint8_t*);
    uint8_t size;
};

constexpr TypeOps type_ops[TAG__COUNT] = {
    /*BOOL  */ { force_impl<bool>,     unforce_impl<bool>,     read_impl<bool>,     1 },
    /*SINT  */ { force_impl<int8_t>,   unforce_impl<int8_t>,   read_impl<int8_t>,   1 },
    /*...   */
    /*STRING*/ { /* special-case: variable-length */ nullptr, nullptr, nullptr, 0 },
};

inline Entry read_entry(uint8_t arr, uint16_t elem);  // PROGMEM-aware accessor

inline void handle_set(uint8_t arr, uint16_t elem, bool forcing, const uint8_t* bytes) {
    auto e = read_entry(arr, elem);
    if (forcing) type_ops[e.tag].force(e.ptr, bytes);
    else          type_ops[e.tag].unforce(e.ptr);
}

inline void handle_read(uint8_t arr, uint16_t elem, uint8_t* dest) {
    auto e = read_entry(arr, elem);
    type_ops[e.tag].read(e.ptr, dest);
}

} // namespace strucpp::debug
```

STRING/WSTRING need special handling (variable length). Wire format:
`{uint16_t length, bytes[length]}`. Implementation reads/writes into `IECString<N>` via
a specialization rather than the generic `read_impl<T>` template.

### PROGMEM access on ATmega2560

Debug tables will cross the 64 KB Flash boundary for large projects. The `read_entry()`
accessor uses `pgm_read_*_far()` on AVR, a plain array access everywhere else:

```cpp
inline Entry read_entry(uint8_t arr, uint16_t elem) {
#ifdef __AVR__
    uint32_t base = pgm_get_far_address(debug_arrays);
    const Entry* table = (const Entry*)pgm_read_word_far(base + arr * sizeof(void*));
    Entry e;
    // read 4 bytes from PROGMEM, handling far address construction
    uint32_t entry_addr = pgm_get_far_address(*table) + elem * sizeof(Entry);
    e.ptr = (void*)pgm_read_word_far(entry_addr);
    e.tag = pgm_read_byte_far(entry_addr + 2);
    return e;
#else
    return debug_arrays[arr][elem];
#endif
}
```

Slight perf cost (~4 cycles extra per lookup) — irrelevant at debugger polling cadence.

---

## Wire protocol

Function codes keep the 0x41–0x45 numbering (same Modbus dispatcher structure), but the
addressing fields change from `u16 flat_index` to `(u8 array_idx, u16 elem_idx)`.

| FC   | Name                | Request payload                                        | Response payload                                 |
|------|---------------------|--------------------------------------------------------|--------------------------------------------------|
| 0x41 | DEBUG_INFO          | (empty)                                                | `[array_count:u8, (elem_count:u16)×array_count]` |
| 0x42 | DEBUG_SET           | `arr:u8, elem:u16, force:u8, len:u16, value...`        | `status:u8`                                      |
| 0x43 | DEBUG_GET_RANGE     | `arr:u8, start_elem:u16, end_elem:u16`                 | `status:u8, last_elem:u16, tick:u32, size:u16, data...` |
| 0x44 | DEBUG_GET_LIST      | `count:u16, (arr:u8, elem:u16)×count`                  | `status:u8, last_idx:u16, tick:u32, size:u16, data...`  |
| 0x45 | DEBUG_GET_MD5       | `endian_check:u16`                                     | `status:u8, md5:ascii, endian_echo:u16`          |

Phase 4b additions (subscribe/stream):

| FC   | Name                | Request payload                                        | Response payload                                 |
|------|---------------------|--------------------------------------------------------|--------------------------------------------------|
| 0x46 | WATCH_SUBSCRIBE     | `interval_ms:u16, count:u16, (arr:u8, elem:u16)×count` | `handle:u8, status:u8`                           |
| 0x47 | WATCH_UNSUBSCRIBE   | `handle:u8`                                            | `status:u8`                                      |
| 0x48 | STREAM (unsolicited)| —                                                      | `handle:u8, tick:u32, size:u16, data...`         |

Notes:

- Endianness: data payloads are native byte order of the target (no swap on the wire).
  Editor probes with FC 0x45 and byte-swaps locally if target differs. Matches current
  behavior.
- Chunking: same as today — if a GET_RANGE / GET_LIST response exceeds the Modbus frame
  limit, the target returns what fits and reports `last_idx`. Editor retries from there.
- Per-array addressing implies that `DEBUG_GET_RANGE` operates within a single debug
  array. Cross-array batch reads use `DEBUG_GET_LIST`.
- Unsolicited STREAM frames break strict Modbus master/slave semantics but are safe in
  practice because OpenPLC targets use Modbus RTU over USB-CDC (full-duplex) or TCP.
  RS-485 half-duplex users should stay on polling mode.

---

## Implementation plan

### 4.1 STruC++ runtime — debug dispatch headers *(ships in strucpp@≥0.3.0)*

- `src/runtime/include/debug_dispatch.hpp` — `TypeTag` enum, `Entry` struct, `TypeOps` table,
  templated `force_impl` / `unforce_impl` / `read_impl`, STRING/WSTRING specializations,
  PROGMEM-aware `read_entry()`.
- `src/runtime/include/debug_handler.hpp` — protocol-level helpers:
  `handle_info()`, `handle_set()`, `handle_get_range()`, `handle_get_list()`,
  `handle_get_md5()` — frame-agnostic (take input/output buffers, return bytes written).
- Unit tests in the STruC++ repo covering the templated helpers with a mocked Entry table.

**Exit criteria:** STruC++ runtime exports a single `strucpp::debug::handle_*` API that the
editor's Arduino sketch and the Runtime v4 `.so` can both call. No per-project code here.

### 4.2 STruC++ — debug table & map generator *(ships in strucpp@≥0.3.0)*

Location: inside the STruC++ repo, alongside the existing `generated.cpp`/`generated.hpp`
emitter. Not a separate module — same AST walk that already produces the main C++
output.

Inputs:
- STruC++'s internal AST + symbol table + project model (already built for the main
  compile pass).
- Target hint (optional): `"avr" | "arm" | "linux"` — only used to validate the 8,000
  entries/array cap is sufficient for the target. Emitted output is target-neutral
  thanks to the `STRUCPP_DEBUG_FLASH` macro in the runtime header.

Outputs added to `CompileResult`:
- `debugTableCpp: string` — the full contents of `generated_debug.cpp`.
- `debugMap: DebugMapV2` — a structured object the editor serializes to
  `debug-map.json`.

Core algorithm (lives in the STruC++ codegen):

```
for each program instance in projectModel:
    for each variable in program.vars (in declaration order):
        walk(variable, path = "INSTANCE0.varName"):
            if leaf (elementary type):
                emit entry { &path, tag(type) }
            elif array:
                for i in dimensions:
                    walk(element, path = "${path}[${i}]")
            elif struct/FB:
                for field in fields:
                    walk(field, path = "${path}.${field.name}")
    flush to new debug array  // program-boundary flush
```

Cap per array at 8,000 entries; new array also starts when an element would push the
byte count past 32,000 (safety margin vs. AVR's 32,767 limit).

The TypeTag enum emitted into the cpp file **must match** the one in
`debug_dispatch.hpp`. Both live in the STruC++ repo, so this coupling is enforced by
colocation — no cross-repo drift possible.

**Exit criteria:** `compile()` returns `debugTableCpp` + `debugMap` that together
compile + link + run correctly with the runtime headers. Unit-tested inside STruC++
against projects with mixed scalars/arrays/structs/FBs.

### 4.3 Editor — compiler-module wiring

`src/backend/editor/compiler/compiler-module.ts` becomes a thin pass-through:

- After `handleCompileSTtoCpp()` resolves with the extended `CompileResult`, write
  `result.debugTableCpp` to `<compilationPath>/src/generated_debug.cpp` and
  `JSON.stringify(result.debugMap, null, 2)` to `<compilationPath>/src/debug-map.json`.
- arduino-cli picks up `generated_debug.cpp` automatically (library dir is already
  included).
- No changes to the Arduino sketch — it doesn't reference the debug tables directly;
  the ModbusSlave handlers reach them via the runtime header's `read_entry()`.

That's the entire editor-side generator change: two extra writeFile calls.

### 4.4 Embedded — ModbusSlave integration

`resources/sources/Baremetal/ModbusSlave.cpp`:
- Replace the existing 0x41–0x45 handler bodies (which call the MatIEC-era
  `get_var_count()` / `get_var_addr()` / `set_trace()` weak externs) with direct calls
  into `strucpp::debug::handle_*`.
- Drop the weak-extern declarations.
- Behavior change for FC 0x41: returns `{array_count, (elem_count)×N}` instead of a
  single `var_count`. PDU grows slightly but remains under the Modbus frame limit even
  for 256 arrays (≤513 bytes — chunk if exceeded, though realistic projects have ≤10
  arrays).

### 4.5 Editor — frontend and middleware changes

These are the **only** editor-side changes (kept minimal on purpose):

**`src/middleware/shared/ports/debugger-port.ts`:**
```ts
export interface DebugAddr { arrayIdx: number; elemIdx: number }

getVariablesList(refs: DebugAddr[]): Promise<DebugVariableResult>
setVariable(ref: DebugAddr, force: boolean, valueBuffer?: Uint8Array): Promise<DebugSetResult>
readDebugMap(projectPath: string, boardTarget: string): Promise<DebugMapV2 | null>
```

**`src/frontend/utils/debug-parser.ts`:** Add `parseDebugMapV2()` alongside existing
`parseDebugFile()`. Both paths exist only long enough to flip users over — v1 (MatIEC) is
removed once Phase 4 ships.

**`src/frontend/utils/debugger-session.ts` (`buildVariableIndexMap`):** The composite key
continues to be `pouName:varName.field[idx]`. The value stored in
`workspace.debugVariableIndexes` changes from `number` to `DebugAddr`. Everything
downstream that reads this map updates accordingly (a small, mechanical edit — the polling
loop, the force handler, the tree builder all go through this map).

**`src/frontend/hooks/useDebugPolling.ts`:** No structural change — same batching logic,
same 50/200 ms cadences, same round-robin. Just passes `DebugAddr[]` through to the port
instead of `number[]`.

**`src/frontend/hooks/useDebugSession.ts`:** Reads `debug-map.json` at session start
(via `debuggerPort.readDebugMap()`) instead of `debug.c`. The rest of the lifecycle
(MD5 verify, build tree, start polling) is unchanged.

**Tree builder (`debug-tree-builder.ts` / `debug-tree-traversal.ts`):** Today it expands
arrays eagerly using the flat index. Under v2 it keeps doing the same expansion — the
source of truth moves from `debug.c` to `debug-map.json`, but the UI shape and composite
keys stay identical. A later optimization could lazy-load array children on expand, but
it's not needed for correctness and is out of scope for this phase.

**IPC adapter (`debugger-adapter.ts`):** Serializes `DebugAddr` pairs over the bridge.
Trivial.

### 4.6 Subscribe / stream (Phase 4b — follow-up)

Deferred until Phase 4a is stable and the basic polling path is validated end-to-end.

Target side:
- `strucpp::debug::handle_subscribe()` stores `{handle, interval_ms, address_list[]}` in
  a fixed-size table (max ~4 subscriptions). On each scan cycle, if `tick * scan_ms >=
  next_emit_time`, assemble a 0x48 frame and hand it to `ModbusSlave.sendUnsolicited()`.
- `ModbusSlave` gets a new `sendUnsolicited(frame, len)` method. Must not interleave with
  a request currently being served — use a tiny flag.

Editor side:
- `debuggerPort.subscribe(addrs, intervalMs) -> handle` and a handler in `useDebugPolling`
  that, when subscriptions are active, stops polling those addresses and listens for
  STREAM frames instead.

### 4.7 Runtime v4 integration

`src/backend/shared/utils/PLC/generate-v4-compat.ts` already exports C-linkage shims for
the Runtime v4 `.so`. Add:

```c
extern "C" uint8_t  strucpp_debug_array_count();
extern "C" uint16_t strucpp_debug_elem_count(uint8_t arr);
extern "C" void     strucpp_debug_set (uint8_t arr, uint16_t elem, bool force,
                                        const uint8_t* bytes, uint16_t len);
extern "C" void     strucpp_debug_read(uint8_t arr, uint16_t elem,
                                        uint8_t* dest, uint16_t* size_out);
```

These are thin wrappers over `strucpp::debug::handle_*`. The runtime's existing
`debug_handler.c` is replaced by a much smaller shim that parses Modbus PDUs and calls
these exports.

---

## Scalability summary

| Project size | Debug arrays | Flash (table) | SRAM |
|--------------|--------------|---------------|------|
| 50 leaves    | 1            | 200 B         | 0 B  |
| 500 leaves   | 1            | 2 KB          | 0 B  |
| 3,500 leaves | 1            | 14 KB         | 0 B  |
| 20,000 leaves| 3            | 80 KB         | 0 B  |
| 50,000 leaves| 7            | 200 KB        | 0 B  |

(AVR Mega has 256 KB Flash — fits projects up to ~50K leaves *in theory*; realistic
embedded deployments top out well below that.)

---

## Testing strategy

1. **STruC++ runtime tests:** `debug_dispatch.hpp` force/read cycle for each
   `TypeTag`, using a synthetic Entry table and a mock IECVar. Covers all elementary
   IEC types including STRING/WSTRING special-cases.
2. **STruC++ codegen tests:** `compile()` on projects with mixed scalars, arrays,
   structs, FBs → `debugTableCpp` compiles cleanly with the runtime headers;
   `debugMap` has the expected path/address entries; array packing respects the
   8,000-entry + program-boundary rules.
3. **Size regression (STruC++ + editor):** the 35K-leaf user project that currently
   fails MatIEC must compile cleanly with the new pipeline end-to-end.
4. **End-to-end (Arduino Mega):** reuse the Chris Demo blink project. Force `blink :=
   TRUE` from the editor, verify PB7 stays HIGH across scan cycles. Unforce, verify
   oscillation resumes. Validate in the avr8js simulator first, then hardware.
5. **End-to-end (Runtime v4):** same blink project compiled as `.so`, dlopen'd by the
   runtime, debugger connects via WebSocket, force/read verified.
6. **Regression on existing hierarchical UI:** the composite-key tree, force badges,
   graph/plot, and per-FB instance switching must render identically.

---

## Out of scope for Phase 4

- Breakpoints / step / continue. STruC++ doesn't have source-level step support at this
  point; separate initiative.
- On-demand / lazy array expansion in the UI. Full eager expansion is kept for
  compatibility; an optimization pass can add lazy loading later if large-array
  rendering becomes a bottleneck.
- Per-variable rate limiting on subscriptions. A single interval per subscription handle
  is sufficient for Phase 4b.

---

## Open items to confirm during implementation

1. **`g_config` static address stability on AVR.** The `&g_config.INSTANCE0.counter`
   expressions in `generated_debug.cpp` must be constant expressions for PROGMEM
   initializers. If the AVR linker ever decides `g_config` needs dynamic construction
   (it shouldn't — it's a static POD-constructible instance), we'd need to populate the
   table at runtime in `setup()`. Verify with a test compile.
2. **String length encoding.** Fixed-size `IECString<N>` has a runtime length field plus
   up to N bytes of data. Wire encoding for Phase 4a: `{u16 len, bytes[len]}`. Confirm
   that forcing a longer value than N is rejected cleanly (return an error status in FC
   0x42).
3. **MD5 scope.** Since STruC++ now owns both the runtime headers and the debug-map
   generator, it should compute the MD5 itself over the inputs it actually consumed —
   at minimum `{program.st, strucpp_version}`, optionally including the serialized
   `debugMap` so any generator change invalidates stale editor state. Emit the MD5
   as a field on `debugMap` and expose the same value to the target via FC 0x45.
