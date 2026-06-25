# Phase 5: Runtime v4 `.so` Interface (C++ Runtime, Minimal Shim)

> **Revision history.**
>
> 1. *Original draft (pre-Arduino).* Proposed a flat-index `debug_vars[]`-shaped
>    compatibility layer in a `v4_compat.cpp` shim, with Phase 7 later
>    upgrading the runtime to hierarchical addressing.
> 2. *First revision.* Arduino shipped with hierarchical `(arr_idx, elem_idx)`
>    debug from day one; the flat compatibility layer was dropped. The shim
>    grew to ~150 lines (`runtime_v4_entry.cpp`) and was packaged by the
>    editor into every project's upload zip. Runtime stayed C and used
>    extensive C-linkage exports (`strucpp_get_task_count`, `strucpp_run_task`,
>    `strucpp_get_located_vars`, …).
> 3. **Current revision.** The runtime sources become C++. The C-linkage
>    surface collapses to a *single* entry symbol — `strucpp_get_config()` —
>    plus the debug-PDU shims provided by `debug_dispatch.hpp`. The shim
>    file shrinks to ~10 lines and **lives in the runtime repo**, not the
>    editor. The editor's upload bundle goes back to just
>    `generated.cpp` / `generated.hpp` / `generated_debug.cpp` plus the
>    versioned strucpp runtime header set.

## Goal

Build a STruC++-compiled `.so` that the OpenPLC Runtime v4 can `dlopen()` and
operate on directly using STruC++'s native C++ class hierarchy — no
per-walk shim functions, no per-project glue. Achieve this by making the
runtime sources C++ themselves, so they can include the strucpp runtime
headers (`iec_std_lib.hpp`, `iec_located.hpp`, `debug_dispatch.hpp`) and
call into the loaded program through plain virtual dispatch.

## Prerequisites

- Phase 1 (STruC++ dependency infrastructure) — done
- Phase 2 (Editor compiler pipeline) — done
- Phase 3 (Arduino runtime) — done; same `LocatedVar` / `Configuration`
  walking logic applies
- Phase 4 (Debugger) — done; `debug_dispatch.hpp` already exposes
  `STRUCPP_V4_DEBUG_EXPORTS_DEFINE` C-linkage shims for the PDU surface
- Runtime v4 codebase at `~/Documents/Code/openplc-runtime`

## Why C++ Runtime

The runtime is built **once**; the user program `.so` is loaded at
runtime. The runtime cannot include `generated.hpp` because it doesn't
know the program at compile time. But it **can** include the strucpp
runtime headers (which define the stable `ConfigurationInstance`,
`ResourceInstance`, `TaskInstance`, `ProgramBase`, `LocatedVar` types) —
those don't depend on the user program.

Once the runtime has those base classes in scope, virtual dispatch
through a `ConfigurationInstance*` pointer Just Works across DSO
boundaries: the vtable lives in the `.so`, the runtime calls the base
method, dynamic dispatch routes to the right derived implementation.

```cpp
// Runtime (C++):
auto* cfg = strucpp_get_config();              // dlsym'd, returns ConfigurationInstance*
size_t r_count = cfg->get_resource_count();    // virtual dispatch — no shim
auto* res     = cfg->get_resources();          // virtual dispatch — no shim
for (size_t r = 0; r < r_count; ++r) {
    for (size_t t = 0; t < res[r].task_count; ++t) {
        auto& task = res[r].tasks[t];
        // task.name, task.interval_ns, task.priority — direct field reads
        // task.programs[p]->run() — virtual dispatch into the .so's program body
    }
}
```

The 150-line `runtime_v4_entry.cpp` from the previous revision (with its
`strucpp_get_task_count`, `strucpp_get_task_name`,
`strucpp_get_task_interval_ns`, `strucpp_get_task_priority`,
`strucpp_run_task`, `strucpp_get_located_var_count`,
`strucpp_get_located_vars` exports) — all gone. The runtime walks the
configuration directly.

## What the .so Exports (the Whole Surface)

Five entry points plus two read-only data symbols. Two of the entry
points are debug PDU shims provided by `debug_dispatch.hpp`; one is the
`Configuration` accessor the runtime walks; one is the locks setter the
runtime calls right after `dlopen` (Phase 8 plumbing); one is the
debug-PDU set/read pair.

```c
/* From the runtime-side shim (one source file in openplc-runtime):     */
extern strucpp::ConfigurationInstance* strucpp_get_config(void);
extern void strucpp_set_locks(pthread_mutex_t* image_tables_mutex,
                              pthread_mutex_t* global_vars_mutex);

/* From debug_dispatch.hpp's STRUCPP_V4_DEBUG_EXPORTS_DEFINE block:     */
extern uint8_t  strucpp_debug_array_count(void);
extern uint16_t strucpp_debug_elem_count(uint8_t arr);
extern uint16_t strucpp_debug_size(uint8_t arr, uint16_t elem);
extern uint8_t  strucpp_debug_set(uint8_t arr, uint16_t elem,
                                  bool forcing,
                                  const uint8_t *bytes, uint16_t len);
extern uint16_t strucpp_debug_read(uint8_t arr, uint16_t elem,
                                   uint8_t *dest);

/* From generated.cpp directly — STruC++ already emits these:            */
extern unsigned long long common_ticktime__;     /* informational */
extern const char        *plc_program_md5;       /* MD5 of program.st  */
```

**Mutex ownership.** The runtime owns the image-tables mutex (the
existing `buffer_mutex`) and a new globals mutex; both are recursive
priority-inheriting `pthread_mutex_t`. The `.so` doesn't allocate
either — it just stores the pointers the runtime hands it via
`strucpp_set_locks` and exposes them through the lock guards in
`iec_threading.hpp` (Phase 8). One mutex per resource, no duplicates.

The debug PDU functions still exist as C-linkage shims because they need
to resolve `debug_arrays[]` / `debug_array_counts[]` / `debug_array_count`
inside the `.so`'s own address space — that's fundamentally a cross-DSO
data access, which virtual dispatch doesn't help with. One `#define` in
the runtime shim file enables them.

Symbols that **don't** need to exist anywhere:

| Old surface | Reason it's gone |
|---|---|
| `config_run__` | Runtime calls `task.programs[p]->run()` directly via vtable |
| `glueVars` / `setBufferPointers` / `setBufferPointers_v4` | Runtime walks `strucpp::locatedVars[]` itself |
| `set_endianness` | STruC++ uses fixed-width types; editor probes via the MD5 echo in FC 0x45 |
| `strucpp_get_task_count` / `strucpp_get_task_name` / `strucpp_get_task_interval_ns` / `strucpp_get_task_priority` / `strucpp_run_task` | Direct virtual dispatch on `ConfigurationInstance*` |
| `strucpp_get_located_var_count` / `strucpp_get_located_vars` | `strucpp::locatedVars` and `locatedVarsCount` are accessed directly through the strucpp namespace (the runtime includes `iec_located.hpp`) |
| `trace_reset`, `get_var_count` / `get_var_size` / `get_var_addr` / `set_trace` (the legacy MatIEC flat-index surface) | Replaced by `strucpp_debug_*`. Plugins that consumed these (OPC UA primarily) are paused until Phase 9. |
| `strucpp_debug_get_addr` (the optional address-accessor that fed `plugin_utils.c`) | Removed alongside the flat-index plugin compat |
| `python_loader_set_loggers` | Out of scope for this phase; covered separately when Python POU bridge is reworked |

## The Runtime-Side Shim

Lives in **`openplc-runtime/core/strucpp_runtime/runtime_v4_entry.cpp`**.
About 10 lines, identical for every project, compiled into every
`libplc_<hash>.so`:

```cpp
// runtime_v4_entry.cpp
//
// Static entry shim for STruC++-compiled OpenPLC programs on Linux.
// The runtime dlopens the .so and dlsyms:
//   - strucpp_get_config()  — for walking the configuration via vtable
//   - strucpp_set_locks()   — to plumb the runtime-owned mutexes in
//   - strucpp_debug_*       — the PDU helpers defined by debug_dispatch.hpp
//
// All other interactions are virtual dispatch through ConfigurationInstance*.

#define STRUCPP_V4_DEBUG_EXPORTS_DEFINE
#include "debug_dispatch.hpp"
#include "iec_threading.hpp"  // declares strucpp::g_image_tables_mutex_ptr etc.
#include "generated.hpp"

#include <pthread.h>

namespace strucpp {
    pthread_mutex_t* g_image_tables_mutex_ptr = nullptr;
    pthread_mutex_t* g_global_vars_mutex_ptr  = nullptr;
}

static strucpp::Configuration_CONFIG0 g_config;

extern "C" strucpp::ConfigurationInstance* strucpp_get_config(void) {
    return &g_config;
}

extern "C" void strucpp_set_locks(pthread_mutex_t* image_tables_mutex,
                                  pthread_mutex_t* global_vars_mutex) {
    strucpp::g_image_tables_mutex_ptr = image_tables_mutex;
    strucpp::g_global_vars_mutex_ptr  = global_vars_mutex;
}
```

That is the entire shim. It belongs in the runtime repo because:

- It is a **build-time concern of the runtime**: `compile.sh` consumes it
  alongside the editor's `generated.cpp/hpp/_debug.cpp` to produce the
  `.so`. The editor doesn't need to know it exists.
- It is **stable** in a way the editor's payload is not — it doesn't
  change per project, only when the runtime's expectations change.
  Versioning it with the runtime keeps the contract owned by one repo.
- It has **no compile-time link** to the editor: nothing in the editor
  references it; nothing copies it; nothing embeds it. The editor's
  upload bundle stops at the user-program payload.

## Editor Upload Bundle (Reduced)

```
core/generated/
├── generated.cpp
├── generated.hpp
├── generated_debug.cpp
├── c_blocks_code.cpp        # only if user used C blocks
├── c_blocks.h               # only if user used C blocks
└── strucpp_runtime/
    └── include/             # full STruC++ runtime header set
        ├── debug_dispatch.hpp
        ├── iec_std_lib.hpp
        ├── iec_var.hpp
        ├── iec_located.hpp
        └── ... (all STruC++ runtime headers, version-locked to the
                 STruC++ release that produced generated.cpp)
```

No `runtime_v4_entry.cpp/h`. No `resources/openplc-runtime-shim/` tracked
folder in the editor repo (delete it from this branch — it was added in
the previous revision to mirror the shim files; it's now obsolete).

## Runtime-Side Source Conversion

The following sources convert from `.c` to `.cpp` so they can include the
strucpp runtime headers and call virtual methods on `ConfigurationInstance*`:

```
core/src/plc_app/plc_main.c            -> plc_main.cpp
core/src/plc_app/image_tables.c        -> image_tables.cpp
core/src/plc_app/debug_handler.c       -> debug_handler.cpp
core/src/plc_app/plc_state_manager.c   -> plc_state_manager.cpp
core/src/plc_app/scan_cycle_manager.c  -> scan_cycle_manager.cpp
core/src/plc_app/plc_io_cycle.c        -> plc_io_cycle.cpp
core/src/plc_app/plcapp_manager.c      -> plcapp_manager.cpp
core/src/plc_app/unix_socket.c         -> stays C (pure POSIX)
core/src/plc_app/journal_buffer.c      -> stays C (pure C)
core/src/plc_app/utils/utils.c         -> stays C (pure POSIX)
core/src/plc_app/utils/log.c           -> stays C
core/src/plc_app/utils/watchdog.c      -> stays C (only references
                                                   PlcTaskCtx / atomic_long)
```

Mechanical changes that ripple through:

- `CMakeLists.txt`: project type changes from `C` to `CXX`, sources move
  from `add_executable(... .c)` to `.cpp`. Add `target_compile_features(plc_main PRIVATE cxx_std_17)`.
- `Python.h` is C; any `.cpp` that touches it wraps the include in
  `extern "C" { ... }`. Same for `dlfcn.h` (already declared `extern "C"`,
  so usually transparent).
- All previously-`extern` C-linkage globals stay valid: declarations like
  `extern unsigned long tick__;` work identically in C++ TUs.
- The plugin manager (C interface, C-linkage `void*` symbol returns)
  needs no change. C++ callers just use it.

The conversion is mechanical — this is not "rewrite the runtime in C++";
it's "rename the files and let the C code compile under C++". The
behavior is identical until we start using C++ idioms (the
`ConfigurationInstance*` walking, RAII guards, `std::lock_guard`).

## Image-Table Binding

The runtime walks `strucpp::locatedVars[]` itself — same loop the Arduino
sketch uses, lifted into the runtime. Conceptual sketch:

```cpp
void image_tables_bind_located_vars() {
    using namespace strucpp;
    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        const LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) {
            log_warn("locatedVars[%u] has NULL pointer (area=%u size=%u byte=%u bit=%u)",
                     i, (unsigned)lv.area, (unsigned)lv.size,
                     (unsigned)lv.byte_index, (unsigned)lv.bit_index);
            continue;
        }
        switch (lv.area) {
            case LocatedArea::Input:  bind_input(lv);  break;
            case LocatedArea::Output: bind_output(lv); break;
            case LocatedArea::Memory: bind_memory(lv); break;
        }
    }
}
```

The image-table buffers themselves are unchanged (`bool_input[][8]`,
`int_input[]`, `dint_input[]`, etc.). This is the same pattern the
Arduino sketch uses — the whole point is to keep plugins reading raw
pointers exactly as before. `lv.pointer` is `IECVar<T>::raw_ptr()`,
i.e. `&value_` of the IEC variable; plugins reading
`*int_input[byte_index]` see the underlying primitive directly. Forcing
semantics still work because `IECVar<T>::force(v)` writes both
`value_` and `forced_value_`.

## Debug Handler

`debug_handler.cpp` calls the strucpp debug helpers directly through
either:

- The C-linkage shims (`strucpp_debug_set` / `strucpp_debug_read` etc.)
  that `STRUCPP_V4_DEBUG_EXPORTS_DEFINE` provides — dlsym'd from the
  loaded .so so they resolve to the shim's TU which sees the per-project
  `debug_arrays[]`. **This is the path we use** because the runtime is
  loaded once and the .so changes per program.
- Or, if we wanted to skip dlsym, we could include `debug_dispatch.hpp`
  in the runtime — but the inline functions reference `extern const Entry* const debug_arrays[]`
  which only resolves at link time, and we don't link against the .so.
  So dlsym remains the correct boundary.

The debug FC 0x41–0x45 wire format stays exactly as Phase 4 / the Arduino
runtime ship it — including the request-snapshot fix (the request lives
at `mb_frame[3..]`, the response at `mb_frame[10..]`, they overlap; copy
the request before any response writes).

| FC | Name | Wire format |
|---|---|---|
| 0x41 | DEBUG_INFO | req `[FC]` → resp `[FC, arrCount, STATUS, count_0_hi, count_0_lo, …]` |
| 0x42 | DEBUG_SET | req `[FC, arr, elem_hi, elem_lo, force, len_hi, len_lo, value…]` → resp `[FC, STATUS]` |
| 0x43 | DEBUG_GET | req `[FC, arr, start_hi, start_lo, end_hi, end_lo]` → resp `[FC, STATUS, last_hi, last_lo, tick(4), size_hi, size_lo, data…]` |
| 0x44 | DEBUG_GET_LIST | req `[FC, count_hi, count_lo, (arr, elem_hi, elem_lo)×count]` → resp same shape as 0x43 |
| 0x45 | DEBUG_GET_MD5 | req `[FC, endian_hi, endian_lo]` → resp `[FC, STATUS, md5_ascii…, endian_echo_hi, endian_echo_lo]` |

The 1400-byte conservative cap from the Arduino sketch is dropped;
Linux-side `MAX_DEBUG_FRAME` (4 KB or higher) is the only limit.

## Debug Arrays on Linux

Worth a section because the Arduino-Linux protocol parity question keeps
coming up: **the architecture does not change between Arduino and
Linux.** On both, `generated_debug.cpp` emits the same per-array tables,
split at the same 8000-entry threshold. On Arduino these go into
`PROGMEM` (flash). On Linux they go into `.rodata` of the `.so`,
mapped read-only by `dlopen()` with **lazy paging**: the kernel doesn't
load any debug array pages into RAM until something dereferences them,
and a debugger session that scopes ~50 variables only touches a handful
of 4 KB pages.

Even a 30 K-leaf project with a 480 KB debug section costs nothing in
RAM until it's actually scoped. There's no need for a Linux-specific
layout, allocator, or compression scheme. Keeping the protocol identical
between Arduino and Linux targets is a feature, not a constraint to work
around.

## Flat-Index API Removal

The previous revision kept a runtime-side flat→hierarchical translation
table (`image_tables_build_flat_var_map`, `image_tables_flat_var_count`,
`image_tables_flat_var_addr`) so plugins consuming the legacy
`get_var_count` / `get_var_size` / `get_var_addr` API would keep
compiling. **That's gone.**

Reasoning: the flat indexing scheme has no path forward. The editor's
debug-map is hierarchical; the only way a plugin can know which `(arr,
elem)` corresponds to a given user variable is to consume the same
debug-map. Wrapping the new world in old-API clothes obscures rather
than helps the migration.

Concrete deletions:

- `core/src/plc_app/image_tables.{h,c}`: drop `image_tables_build_flat_var_map`,
  `image_tables_flat_var_count`, `image_tables_flat_var_addr`,
  `strucpp_flat_addr_t`, the `g_flat_map` storage.
- `core/src/drivers/plugin_utils.c`: delete the file (or strip it down to
  comments — only the now-removed flat helpers lived there).
- `core/src/drivers/plugin_types.h` (`plugin_runtime_args_t`): remove the
  `get_var_list`, `get_var_size`, `get_var_count` fields.
- `runtime_v4_entry.cpp`: drop `strucpp_debug_get_addr` (it only existed
  to feed `plugin_utils.c`).

Plugins that consumed this surface — primarily the OPC UA Python plugin —
will fail to start. Document this explicitly in the changelog and
`plugins.conf` defaults; OPC UA stays disabled until Phase 9 migrates
it onto the hierarchical PDU API.

## `compile.sh`

```bash
#!/bin/bash
set -euo pipefail

GENERATED_DIR="core/generated"
RUNTIME_INCLUDE="$GENERATED_DIR/strucpp_runtime/include"
RUNTIME_SHIM="core/strucpp_runtime/runtime_v4_entry.cpp"  # tracked in this repo
BUILD_DIR="build"

mkdir -p "$BUILD_DIR"

# Required: editor's payload + the runtime-side shim
[ -f "$GENERATED_DIR/generated.cpp" ]       || { echo "missing $GENERATED_DIR/generated.cpp"      ; exit 1; }
[ -f "$GENERATED_DIR/generated.hpp" ]       || { echo "missing $GENERATED_DIR/generated.hpp"      ; exit 1; }
[ -f "$GENERATED_DIR/generated_debug.cpp" ] || { echo "missing $GENERATED_DIR/generated_debug.cpp"; exit 1; }
[ -f "$RUNTIME_SHIM" ]                       || { echo "missing $RUNTIME_SHIM"                     ; exit 1; }
[ -d "$RUNTIME_INCLUDE" ]                    || { echo "missing $RUNTIME_INCLUDE"                  ; exit 1; }

# Reject stale MatIEC bundles loud and clear
if [ -f "$GENERATED_DIR/Config0.c" ] || [ -f "$GENERATED_DIR/glueVars.c" ]; then
    echo "[ERROR] MatIEC artifacts present in $GENERATED_DIR — re-export from a STruC++-aware editor build" >&2
    exit 2
fi

CXXFLAGS=(
    -std=c++17 -O2 -fPIC -Wall -Wno-unknown-pragmas
    -I "$GENERATED_DIR" -I "$RUNTIME_INCLUDE"
)

g++ "${CXXFLAGS[@]}" -c "$GENERATED_DIR/generated.cpp"        -o "$BUILD_DIR/generated.o"
g++ "${CXXFLAGS[@]}" -c "$GENERATED_DIR/generated_debug.cpp"  -o "$BUILD_DIR/generated_debug.o"
g++ "${CXXFLAGS[@]}" -c "$RUNTIME_SHIM"                       -o "$BUILD_DIR/runtime_v4_entry.o"

EXTRA_OBJS=""
if [ -f "$GENERATED_DIR/c_blocks_code.cpp" ]; then
    g++ "${CXXFLAGS[@]}" -c "$GENERATED_DIR/c_blocks_code.cpp" -o "$BUILD_DIR/c_blocks_code.o"
    EXTRA_OBJS="$BUILD_DIR/c_blocks_code.o"
fi

g++ -shared -fPIC -o "$BUILD_DIR/new_libplc.so" \
    "$BUILD_DIR/generated.o" \
    "$BUILD_DIR/generated_debug.o" \
    "$BUILD_DIR/runtime_v4_entry.o" \
    $EXTRA_OBJS \
    -lpthread -lrt
```

## Files Created / Modified

| File | Action |
|------|--------|
| `openplc-runtime/core/strucpp_runtime/runtime_v4_entry.cpp` | **New** – ~10-line static shim, single C-linkage entry + debug PDU shim activation |
| `openplc-runtime/core/strucpp_runtime/iec_std_lib.hpp` (and the rest of the strucpp runtime header set) | Vendored at a known version, mirror of `resources/strucpp/runtime/include/` from the editor; provides the base classes and `LocatedVar` to the runtime's C++ TUs |
| `openplc-runtime/core/include/strucpp/runtime_v4_entry.h` | **Deleted** – C-linkage typedefs no longer needed (runtime is C++ now) |
| `openplc-runtime/core/strucpp_runtime_template/runtime_v4_entry.cpp` | **Deleted** – previous 150-line template, replaced by the 10-line shim above |
| `openplc-runtime/core/src/plc_app/*.c` | Renamed to `.cpp` (mechanical) |
| `openplc-runtime/core/src/plc_app/image_tables.{h,cpp}` | Walks `strucpp::locatedVars[]` directly via included `iec_located.hpp`; drops flat-index map and all flat helpers |
| `openplc-runtime/core/src/plc_app/debug_handler.cpp` | Calls `strucpp_debug_*` shims dlsym'd from the .so |
| `openplc-runtime/core/src/plc_app/plc_state_manager.cpp` | dlsyms `strucpp_get_config()`, walks the configuration via virtual dispatch, spawns task threads (Phase 6 territory) |
| `openplc-runtime/core/src/drivers/plugin_utils.c` | **Deleted** |
| `openplc-runtime/core/src/drivers/plugin_types.h` | `get_var_list`/`get_var_size`/`get_var_count` removed from `plugin_runtime_args_t` |
| `openplc-runtime/core/src/CMakeLists.txt` | Project type `C` → `CXX`; sources renamed to `.cpp`; `target_compile_features` C++17 |
| `openplc-runtime/scripts/compile.sh` | Compiles the editor's payload + the runtime shim; rejects MatIEC bundles |
| `openplc-editor/src/backend/editor/compiler/compiler-module.ts` | v4 upload bundle reduced to `generated.cpp/hpp/_debug.cpp` + runtime headers; **does not** ship a runtime shim |
| `openplc-editor/resources/openplc-runtime-shim/` | **Deleted** – obsolete (shim moved to runtime repo) |

## Testing Strategy

1. **Symbol presence**: `nm -gU build/new_libplc.so` lists exactly:
   `strucpp_get_config`, `strucpp_set_locks`, `strucpp_debug_array_count`,
   `strucpp_debug_elem_count`, `strucpp_debug_size`, `strucpp_debug_set`,
   `strucpp_debug_read`, `common_ticktime__`, `plc_program_md5`.
   Nothing else of consequence.
2. **Virtual-dispatch round-trip**: a small C++ harness `dlopen`s the .so,
   resolves `strucpp_get_config`, calls
   `cfg->get_resources()[0].tasks[0].programs[0]->run()`, and verifies the
   program body actually executed.
3. **Image-table binding**: upload a project with mixed `%I` / `%Q` / `%M`
   located variables; verify each shows up in the right runtime buffer
   slot after `image_tables_bind_located_vars()`.
4. **Debug protocol**: editor connects to the runtime via the existing
   debug transport; FC 0x41–0x45 round-trip identically to the Arduino path.
5. **MatIEC bundle rejection**: stage a project zip with `Config0.c` in
   `core/generated/`; `compile.sh` exits with code 2 and a clear message.
6. **OPC UA**: confirm the plugin fails to start with a `Plugin disabled
   pending hierarchical-API migration (see Phase 9)` log line. No
   crashes; the rest of the runtime continues normally.
