# Phase 5: Runtime v4 .so Interface (Hierarchical from Day One)

> **Revision note** — this doc was rewritten after Phase 3/4 (Arduino) shipped.
> The original draft proposed a flat-index `debug_vars[]`-shaped compatibility
> table that would later be removed in Phase 7. That intermediate step is gone.
> Arduino skipped it; the runtime should too. Phase 7's debug-handler work has
> been folded into this phase. The new Phase 7 covers plugin / I/O coordination.

## Goal

Build a STruC++-compiled `.so` that the Linux Runtime v4 can `dlopen()` and
operate on directly, using the hierarchical `(array_idx, elem_idx)` debug
addressing that ships with `debug_dispatch.hpp` and the same task-topology
discovery model the Arduino sketch already uses.

The runtime calls into the `.so` via a small set of `extern "C"` symbols. The
generated C++ stays untouched (no per-project shim is generated); a single
hand-written file `runtime_v4_entry.cpp` lives in `resources/strucpp/runtime/`
and is compiled into every project's `.so` alongside `generated.cpp` and
`generated_debug.cpp`.

## Prerequisites

- Phase 1 (STruC++ dependency infrastructure) -- done
- Phase 2 (Editor compiler pipeline) -- done
- Phase 3 (Arduino runtime) -- done; reference for binding patterns
- Phase 4 (Debugger) -- done; `debug_dispatch.hpp` already exposes the C-linkage
  shims this phase needs (`STRUCPP_V4_DEBUG_EXPORTS_DEFINE` macro)
- Runtime v4 codebase at `~/Documents/Code/openplc-runtime`

## What Goes Away

The MatIEC-era `.so` interface had a lot of incidental surface area that we are
*not* carrying forward:

| Symbol | Status | Why |
|---|---|---|
| `config_init__` | **kept** as a no-op for symmetry; constructor of `g_config` does the work | Static initialization runs at `dlopen` time |
| `config_run__(tick)` | **dropped** | Runtime calls `strucpp_run_task(idx)` per task instead |
| `glueVars` | **dropped** | Runtime walks `locatedVars[]` directly (same pattern as Arduino sketch) |
| `setBufferPointers` / `setBufferPointers_v4` | **dropped** | Runtime owns its image tables; no pointer plumbing through the .so |
| `set_endianness` | **dropped** | STruC++ uses fixed-width types; the editor probes endianness via the MD5 echo (FC 0x45) |
| `trace_reset` | **dropped** | The editor unforces individually; no need for a bulk-reset path |
| `get_var_count` / `get_var_size` / `get_var_addr` / `set_trace` (flat) | **dropped** | Replaced by `strucpp_debug_*` (hierarchical) |
| `python_loader_set_loggers` | **deferred to a later phase** | Python POU bridge is independent of the compiler change; covered separately |
| `common_ticktime__` | **kept as informational** | Used for diagnostics and as a fallback if no tasks are declared |
| `updateTime` | **kept** | Increments `__CURRENT_TIME` so IEC time functions work; called once per cycle by the I/O coordinator |
| `plc_program_md5` | **kept** | Computed by the editor, embedded by STruC++ in `debug-map.json`, exposed as a C string |

## The New .so Symbol Surface

All exports go through `runtime_v4_entry.cpp`. The runtime dlsyms exactly these
names:

```c
/* ---- Lifecycle --------------------------------------------------------- */
void   config_init__(void);                  /* no-op for symmetry */
void   updateTime(void);                     /* advance __CURRENT_TIME */
extern unsigned long long common_ticktime__; /* GCD ns; informational */
extern const char *plc_program_md5;          /* null-terminated hex string */

/* ---- Topology (replaces config_run__ + glueVars + setBufferPointers) --- */
size_t      strucpp_get_task_count(void);
const char* strucpp_get_task_name(size_t task_idx);
int64_t     strucpp_get_task_interval_ns(size_t task_idx);
int         strucpp_get_task_priority(size_t task_idx);
void        strucpp_run_task(size_t task_idx);

/* ---- I/O binding ------------------------------------------------------- */
uint32_t          strucpp_get_located_var_count(void);
const LocatedVar* strucpp_get_located_vars(void); /* descriptor array */

/* ---- Debug (already exposed by debug_dispatch.hpp) --------------------- */
uint8_t  strucpp_debug_array_count(void);
uint16_t strucpp_debug_elem_count(uint8_t arr);
uint16_t strucpp_debug_size(uint8_t arr, uint16_t elem);
uint8_t  strucpp_debug_set(uint8_t arr, uint16_t elem,
                           bool forcing,
                           const uint8_t *bytes, uint16_t len);
uint16_t strucpp_debug_read(uint8_t arr, uint16_t elem, uint8_t *dest);

/* ---- Capability flag --------------------------------------------------- */
extern const uint32_t strucpp_capabilities; /* bit 0 = per-task; bit 1 = hier debug */
```

`LocatedVar` is the existing struct from `iec_located.hpp`. The runtime header
`runtime_v4_entry.h` (also shipped in `resources/strucpp/runtime/`) re-declares
it with C linkage so the runtime's C code can include it without dragging in
C++ machinery.

## runtime_v4_entry.cpp

This file is **not** generated per-project. It is hand-written and lives at:

```
resources/strucpp/runtime/runtime_v4_entry.cpp
resources/strucpp/runtime/runtime_v4_entry.h
```

It walks `g_config.get_resources()` the same way the Arduino sketch does, but
exposes the topology by index instead of building a flat program array.

```cpp
// runtime_v4_entry.cpp
//
// Static C-linkage entry points for the OpenPLC Runtime v4 .so.
// Identical for every project; compiled alongside generated.cpp and
// generated_debug.cpp into libplc_<hash>.so.

#define STRUCPP_V4_DEBUG_EXPORTS_DEFINE   // exposes strucpp_debug_* shims
#include "debug_dispatch.hpp"

#include "generated.hpp"
#include "iec_located.hpp"

#include <cstdint>
#include <cstddef>
#include <cstring>

using namespace strucpp;

// ---------------------------------------------------------------------------
// Configuration singleton.
// External linkage so generated_debug.cpp's compile-time address-of expressions
// resolve at link time. Same constraint as the Arduino sketch's g_config.
// ---------------------------------------------------------------------------
Configuration_CONFIG0 g_config;

// ---------------------------------------------------------------------------
// Topology cache.
//
// We flatten (resource, task) pairs into a single zero-based task_idx so the
// runtime doesn't need to know the resource layout. Tasks are sorted by
// priority descending so task 0 is always the highest-priority task — the
// runtime relies on this when assigning per-task heartbeats and choosing
// where to drive the I/O coordinator.
// ---------------------------------------------------------------------------
struct TaskRef {
    TaskInstance* task;
    int32_t       priority;
};

static constexpr size_t MAX_TASKS = 32;
static TaskRef g_tasks[MAX_TASKS];
static size_t  g_task_count = 0;
static bool    g_topology_built = false;

static void build_topology() {
    if (g_topology_built) return;

    auto* resources = g_config.get_resources();
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            if (g_task_count >= MAX_TASKS) break;
            g_tasks[g_task_count].task     = &resources[r].tasks[t];
            g_tasks[g_task_count].priority = resources[r].tasks[t].priority;
            g_task_count++;
        }
    }

    // Insertion sort by priority descending (priority high → low).
    for (size_t i = 1; i < g_task_count; ++i) {
        TaskRef key = g_tasks[i];
        size_t j = i;
        while (j > 0 && g_tasks[j - 1].priority < key.priority) {
            g_tasks[j] = g_tasks[j - 1];
            --j;
        }
        g_tasks[j] = key;
    }

    g_topology_built = true;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
extern "C" void config_init__(void) {
    build_topology();
    // Configuration_CONFIG0 default constructor already ran during static init.
}

extern "C" unsigned long long common_ticktime__ = 20000000ULL; // overwritten in config_init__ once topology is known

extern "C" const char *plc_program_md5 = STRUCPP_PLC_PROGRAM_MD5;
// STRUCPP_PLC_PROGRAM_MD5 is defined in generated.hpp by the compiler.

extern "C" void updateTime(void) {
    extern IEC_TIME __CURRENT_TIME;
    __CURRENT_TIME.tv_nsec += static_cast<int32_t>(common_ticktime__ % 1000000000ULL);
    __CURRENT_TIME.tv_sec  += static_cast<long>(common_ticktime__ / 1000000000ULL);
    if (__CURRENT_TIME.tv_nsec >= 1000000000) {
        __CURRENT_TIME.tv_nsec -= 1000000000;
        __CURRENT_TIME.tv_sec  += 1;
    }
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------
extern "C" size_t strucpp_get_task_count(void) {
    build_topology();
    return g_task_count;
}

extern "C" const char* strucpp_get_task_name(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return "";
    return g_tasks[task_idx].task->name;
}

extern "C" int64_t strucpp_get_task_interval_ns(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return 0;
    return g_tasks[task_idx].task->interval_ns;
}

extern "C" int strucpp_get_task_priority(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return 0;
    return g_tasks[task_idx].priority;
}

extern "C" void strucpp_run_task(size_t task_idx) {
    if (task_idx >= g_task_count) return;
    TaskInstance* task = g_tasks[task_idx].task;
    for (size_t p = 0; p < task->program_count; ++p) {
        task->programs[p]->run();
    }
}

// ---------------------------------------------------------------------------
// I/O binding — descriptor-walking is the runtime's job.
// ---------------------------------------------------------------------------
extern "C" uint32_t strucpp_get_located_var_count(void) {
    return locatedVarsCount;
}

extern "C" const LocatedVar* strucpp_get_located_vars(void) {
    return locatedVars;
}

// ---------------------------------------------------------------------------
// Capabilities
//   bit 0 — supports per-task threading (strucpp_run_task)
//   bit 1 — supports hierarchical debug (strucpp_debug_*)
// ---------------------------------------------------------------------------
extern "C" const uint32_t strucpp_capabilities = 0x0003;
```

The `STRUCPP_PLC_PROGRAM_MD5` macro is emitted into `generated.hpp` by the
STruC++ compiler when `--md5=...` is passed; the editor already computes the
MD5 over `program.st` and forwards it via `compileOptions.md5`.

## Runtime side: image-table binding

The runtime's `image_tables.c:symbols_init()` is rewritten to dlsym the new
symbol surface and walk `locatedVars[]` directly. The `setBufferPointers*` /
`glueVars` plumbing is removed.

```c
/* image_tables.c (sketch) */

static const LocatedVar* (*ext_strucpp_get_located_vars)(void) = NULL;
static uint32_t          (*ext_strucpp_get_located_var_count)(void) = NULL;

void image_tables_bind_located_vars(void) {
    if (!ext_strucpp_get_located_vars) return;

    const LocatedVar* lv_array = ext_strucpp_get_located_vars();
    uint32_t lv_count          = ext_strucpp_get_located_var_count();

    for (uint32_t i = 0; i < lv_count; ++i) {
        const LocatedVar* lv = &lv_array[i];
        if (!lv->pointer) {
            log_warn("locatedVars[%u] has null pointer (area=%d size=%d byte=%u bit=%u)",
                     i, (int)lv->area, (int)lv->size, lv->byte_index, lv->bit_index);
            continue;
        }
        switch (lv->area) {
            case LV_INPUT:  bind_input(lv);  break;
            case LV_OUTPUT: bind_output(lv); break;
            case LV_MEMORY: bind_memory(lv); break;
        }
    }
}
```

`LV_INPUT`/`LV_OUTPUT`/`LV_MEMORY` are C-linkage constants for the
`LocatedArea` enum, declared in `runtime_v4_entry.h`. The bind helpers are
existing per-area logic adapted from the v3 `glueVars` semantics — same
buffers (`bool_input[][]`, `int_input[]`, etc.), just driven by the
descriptor walk instead of a generated function.

## Debug handler

`debug_handler.c` is rewritten around the hierarchical addressing. Function
codes 0x41–0x45 are kept (wire compatibility with the editor and the Arduino
runtime); the payload format is the one the editor already speaks.

| FC | Name | Request | Response |
|---|---|---|---|
| 0x41 | DEBUG_INFO | `[FC]` | `[FC, arrCount, STATUS, count_0_hi, count_0_lo, count_1_hi, count_1_lo, ...]` |
| 0x42 | DEBUG_SET | `[FC, arr, elem_hi, elem_lo, force, len_hi, len_lo, value...]` | `[FC, STATUS]` |
| 0x43 | DEBUG_GET | `[FC, arr, start_hi, start_lo, end_hi, end_lo]` | `[FC, STATUS, last_hi, last_lo, tick(4), size_hi, size_lo, data...]` |
| 0x44 | DEBUG_GET_LIST | `[FC, count_hi, count_lo, (arr, elem_hi, elem_lo)×count]` | same shape as 0x43 |
| 0x45 | DEBUG_GET_MD5 | `[FC, endian_hi, endian_lo]` | `[FC, STATUS, md5_ascii..., endian_echo_hi, endian_echo_lo]` |

The Modbus implementation can lift the Arduino logic from
`StrucppBaremetal/ModbusSlave.cpp:1050-1310` near-verbatim. Keep the
**request snapshot** trick (`localIndex[]` copy before any response writes —
the request and response buffers overlap inside `mb_frame[]`).

The runtime supports larger PDUs than Arduino (Modbus TCP/WebSocket can carry
the full 65,535-byte payload), so the conservative 1400-byte cap from the
Arduino sketch can be removed; replace with a check against the actual frame
buffer size.

## compile.sh changes

`openplc-runtime/scripts/compile.sh` is rewritten to compile C++17 with
STruC++ runtime headers. The MatIEC build is removed (no fallback path).

```bash
#!/bin/bash
set -euo pipefail

GENERATED_DIR="core/generated"
RUNTIME_INCLUDE="$GENERATED_DIR/strucpp_runtime/include"
BUILD_DIR="build"

mkdir -p "$BUILD_DIR"

CXXFLAGS="-std=c++17 -O2 -fPIC -Wall -Wno-unknown-pragmas \
          -I$GENERATED_DIR -I$RUNTIME_INCLUDE"

g++ $CXXFLAGS -c "$GENERATED_DIR/generated.cpp"          -o "$BUILD_DIR/generated.o"
g++ $CXXFLAGS -c "$GENERATED_DIR/generated_debug.cpp"    -o "$BUILD_DIR/generated_debug.o"
g++ $CXXFLAGS -c "$GENERATED_DIR/runtime_v4_entry.cpp"   -o "$BUILD_DIR/runtime_v4_entry.o"

if [ -f "$GENERATED_DIR/c_blocks_code.cpp" ]; then
    g++ $CXXFLAGS -c "$GENERATED_DIR/c_blocks_code.cpp"  -o "$BUILD_DIR/c_blocks_code.o"
    EXTRA_OBJS="$BUILD_DIR/c_blocks_code.o"
else
    EXTRA_OBJS=""
fi

g++ -shared -fPIC -o "$BUILD_DIR/new_libplc.so" \
    "$BUILD_DIR/generated.o" \
    "$BUILD_DIR/generated_debug.o" \
    "$BUILD_DIR/runtime_v4_entry.o" \
    $EXTRA_OBJS \
    -lpthread -lrt
```

## Editor upload bundle

The editor packages a zip containing exactly:

```
core/generated/
├── generated.cpp
├── generated.hpp
├── generated_debug.cpp
├── runtime_v4_entry.cpp     # copied from resources/strucpp/runtime/
├── runtime_v4_entry.h       # ditto
├── c_blocks_code.cpp        # only if present
├── c_blocks.h               # only if present
└── strucpp_runtime/
    └── include/             # mirrors resources/strucpp/runtime/include/
        ├── debug_dispatch.hpp
        ├── iec_var.hpp
        ├── iec_located.hpp
        └── ... (all STruC++ runtime headers)
```

The runtime headers are version-locked to the STruC++ compiler that produced
`generated.cpp`. They are downloaded by `scripts/download-binaries.ts`, not
checked into the editor repo.

## Files Created / Modified

| File | Action |
|------|--------|
| `resources/strucpp/runtime/runtime_v4_entry.cpp` | **New** – static C-linkage shim |
| `resources/strucpp/runtime/runtime_v4_entry.h` | **New** – C-linkage `LocatedVar` + enum re-declarations |
| `resources/strucpp/runtime/include/debug_dispatch.hpp` | Already ships C-linkage shims via `STRUCPP_V4_DEBUG_EXPORTS_DEFINE` |
| `src/backend/editor/compiler/compiler-module.ts` | Modified – v4 upload bundle includes runtime headers + `runtime_v4_entry.cpp` |
| `openplc-runtime/scripts/compile.sh` | Modified – C++17 only, no MatIEC |
| `openplc-runtime/core/src/plc_app/image_tables.h` | Modified – include `runtime_v4_entry.h`; add `LocatedVar` references |
| `openplc-runtime/core/src/plc_app/image_tables.c` | Modified – walk `strucpp_get_located_vars()` directly; drop `setBufferPointers*` / `glueVars` |
| `openplc-runtime/core/src/plc_app/debug_handler.c` | Rewritten – hierarchical FC 0x41–0x45 calling `strucpp_debug_*` |
| `openplc-runtime/core/src/plc_app/debug_handler.h` | Modified – signatures reflect new interface |

## Testing Strategy

1. **Symbol presence**: build a sample `.so` with STruC++ output and a hand-rolled
   `runtime_v4_entry.cpp`. Verify with `nm -D --defined-only` that every symbol in
   "The New .so Symbol Surface" is present and unmangled.
2. **`dlopen`/`dlsym` round-trip**: tiny C harness that loads the `.so` and
   calls each exported function on a known-good project. Validate task counts,
   intervals, priorities, located-var counts.
3. **Debug protocol**: send a hand-crafted FC 0x41 request to the runtime and
   verify response format matches the editor's adapter expectations.
4. **End-to-end** (Linux only): upload a sample project, start the runtime,
   open the debugger in the editor, force a variable, observe expected behavior.
5. **No MatIEC remnants**: `grep -r 'iec2c\|matiec\|debug_vars\|setBufferPointers' core/` returns nothing in the runtime tree.
6. **Cross-platform sanity (macOS)**: this phase is implemented on macOS; full
   compilation requires Linux. Static analysis of the changed C files (compile
   with `-fsyntax-only -DSTRUCPP_NOOP_STUB`) is the available validation.
