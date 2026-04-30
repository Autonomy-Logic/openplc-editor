# Phase 8: STruC++ Codegen Runtime Extensions

> **New phase** added during the implementation review. Phase 6 and 7
> exposed two STruC++-side gaps:
>
> 1. The runtime needs **granular synchronization** around image-table
>    and global-variable access, but coarse `buffer_mutex` defeats
>    multi-core parallelism. STruC++ is the right place to emit the
>    locking — it's the only layer that knows which variables are
>    shared. Solution: a `IMAGE_TABLES_LOCK_GUARD()` macro emitted at
>    codegen, no-op on Arduino, RAII lock guard on Linux.
> 2. The runtime needs **per-task CPU affinity** but the user has no way
>    to express it today. Solution: a new optional `CPU_AFFINITY`
>    parameter on `TASK` declarations, stored in `TaskInstance` and
>    applied by the runtime when non-zero.

## Goal

Extend STruC++'s codegen so the runtime side can ship granular
synchronization and user-defined CPU affinity without per-platform
forks of the generated code. Same `generated.cpp/hpp` runs unmodified
on Arduino (no threads, no affinity, the macros and accessors expand to
nothing) and on Linux (full locking and affinity).

## Prerequisites

- Phase 5 (runtime → C++) — informs the lock-guard expansion target
- Phase 6 (thread-per-task) — the consumer of `TaskInstance::cpu_affinity_mask`
- Phase 7 (plugin worker threads) — also consumes
  `IMAGE_TABLES_LOCK_GUARD()` from plugin code

## Part A: `IMAGE_TABLES_LOCK_GUARD()` Codegen Macro

### What gets locked

There are exactly two categories of state that cross thread boundaries
between IEC tasks and plugin workers:

1. **Located variables** (`%IX`, `%IW`, `%QX`, `%QW`, `%MW`, `%MD`,
   `%MX`, etc.) — written by plugins, read by user code; or written by
   user code, read by plugins.
2. **Global variables** (`VAR_GLOBAL` declared at CONFIGURATION /
   RESOURCE level, accessed via `VAR_EXTERNAL`) — potentially shared
   between any two tasks that reference them.

Local task-internal variables, function-block instance state, and
function parameters are **not** shared and need no locking.

### The macro

Emitted by STruC++ at points it determines need synchronization. The
macro itself lives in a strucpp runtime header (`iec_threading.hpp` or
similar):

```cpp
// iec_threading.hpp — strucpp runtime header

#pragma once

#if defined(STRUCPP_THREADING)             // defined by the build for Linux .so
    #include <mutex>
    namespace strucpp {
        inline std::mutex g_image_tables_mutex;
    }
    #define IMAGE_TABLES_LOCK_GUARD()                                \
        std::lock_guard<std::mutex> _strucpp_itlg_(::strucpp::g_image_tables_mutex)
#else
    // Arduino (and any other single-threaded target): zero overhead, no
    // dependency on <mutex>. Same source compiles unchanged.
    #define IMAGE_TABLES_LOCK_GUARD() ((void)0)
#endif
```

`STRUCPP_THREADING` is defined by `compile.sh` on Linux and not on
Arduino. The same `generated.cpp` ships everywhere.

### RAII vs paired macros

The user originally proposed a paired `CAPTURE_IMAGE_TABLES_MUTEX()` /
`RELEASE_IMAGE_TABLES_MUTEX()` shape. RAII is preferred because:

- It can't leak the lock on an early return / exception / longjmp out
  of the task body (and the runtime's per-thread crash handler does
  exactly that).
- It compiles to identical machine code under `-O2` (the destructor is
  inlined and reduces to a single call to `pthread_mutex_unlock` on
  scope exit).
- It's a single line at the codegen site instead of two, simplifying
  the codegen.

For users who really need manual capture/release semantics (e.g., to
release the lock before a long blocking operation inside a task body),
STruC++ can still emit:

```cpp
::strucpp::g_image_tables_mutex.lock();
// ... stuff ...
::strucpp::g_image_tables_mutex.unlock();
```

…but the default at codegen is RAII.

### Granularity decision

**Per-task-body, not per-access.** Three reasons:

1. **Performance.** A loop reading `%IW0` 1000 times in a task body
   would take/release the lock 1000 times under per-access locking. The
   serialization is irrelevant (it's the same thread holding the lock
   each time), but the atomic operations add up.
2. **Correctness.** Per-access locking gives a sequence of
   "atomic single-variable accesses" but the task body's logic spans
   multiple variables — the user's intent is "this scan's view of the
   image table is consistent". Holding the lock for the body provides
   that.
3. **Static analysis is cheap.** STruC++ already knows during
   `generateProgramImplementation` which variables a task body touches.
   Emitting a single `IMAGE_TABLES_LOCK_GUARD()` at the top of the body
   when the task touches anything shared, and emitting nothing
   otherwise, is a one-line change at codegen.

Concretely, the codegen emits:

```cpp
// Generated body of a task that touches shared state
void Program_MAIN::run() {
    IMAGE_TABLES_LOCK_GUARD();
    // ... user code with %IW0 reads, GLOBAL_COUNTER writes, etc. ...
}

// Generated body of a task that touches NO shared state — no lock guard
void Program_PURE_COMPUTE::run() {
    // ... user code with only local variables ...
}
```

Tasks with no shared access run **fully lock-free** in parallel on
multi-core. That's the whole point of granular locking.

The journal-drain call also runs inside this lock. STruC++ doesn't emit
the journal call itself — that's a runtime concern — but the runtime
side relies on the codegen-emitted lock to be in scope when it drains.
See Phase 7 for the wire-up.

### Plugin-side use

Plugin worker threads need the same lock when writing through the
journal helpers (which copy from journal into image table). That's
runtime-side code, not generated by STruC++, so the runtime simply
includes `iec_threading.hpp` (or links the same TU that defines
`g_image_tables_mutex`) and calls `IMAGE_TABLES_LOCK_GUARD()` directly.
Same primitive, same mutex object, both sides serialize correctly.

### The "shared variable" analysis

STruC++ marks a variable as shared if any of:

- It is a located variable (`AT %...`).
- It is declared `VAR_GLOBAL` at CONFIGURATION or RESOURCE scope.
- It is referenced via `VAR_EXTERNAL` from a program.

A task body is "lockable" (gets the macro emitted) if:

- It writes or reads any variable in the shared set, OR
- It calls a function or function block whose body transitively does so.

Transitive analysis follows STruC++'s existing call graph; this is
already maintained for type-checking and dead-code elimination.

False positives (emitting the lock guard when not strictly needed) are
acceptable. False negatives (failing to emit when needed) are bugs and
the analysis errs on the conservative side: "if STruC++ can't prove a
function is shared-free, treat as shared".

### Wire-format / ABI considerations

The macro is a compile-time decision. There is no runtime negotiation —
the .so either has the lock guards baked in (when compiled with
`STRUCPP_THREADING`) or doesn't. The runtime expects them to be there;
if a `.so` compiled without `STRUCPP_THREADING` is loaded into the
threaded runtime, races are possible. `compile.sh` always defines
`STRUCPP_THREADING` for the v4 target, so this is a contract violation
that can't happen in practice.

## Part B: `CPU_AFFINITY` on `TASK` Declarations

### Syntax extension

Add an optional `CPU_AFFINITY` parameter to `TASK` declarations:

```iec
TASK FastTask  (INTERVAL := T#10ms,  PRIORITY := 80, CPU_AFFINITY := 16#03);
TASK SlowTask  (INTERVAL := T#100ms, PRIORITY := 30);   (* no affinity — kernel decides *)
```

`CPU_AFFINITY` is a `WORD`/`DWORD`/`LWORD` bitmask, one bit per CPU.
Bit 0 = CPU 0, bit 1 = CPU 1, etc. Up to 64 bits supported (the runtime
only consumes up to `CPU_SETSIZE`, but 64 covers all realistic targets).

When omitted, the value defaults to **0**, which the runtime
interprets as "no pinning, kernel decides" — the previous Phase 6
revision's hardcoded round-robin pinning is gone.

### Parser change

STruC++'s `TASK` parser already accepts `INTERVAL` and `PRIORITY`. Add
`CPU_AFFINITY` as a third optional parameter, accepting a hex/decimal
literal.

The grammar addition is local: the existing `TaskParameters` rule gets
an additional alternative. No type-checker changes are needed beyond
"must be an integer literal that fits in 64 bits".

### `TaskInstance` ABI

```cpp
// strucpp/runtime/include/iec_std_lib.hpp

struct TaskInstance {
    const char*   name;
    int64_t       interval_ns;
    int32_t       priority;
    ProgramBase** programs;
    size_t        program_count;
    uint64_t      cpu_affinity_mask;   // NEW — 0 means kernel decides
};
```

Adding a field at the end of the struct is ABI-compatible with existing
runtimes: `Configuration` constructors that don't initialize it leave it
zero (struct default-init), which the runtime correctly interprets as
"no affinity". This means existing Arduino projects and any v4 .so
built before this change continue to work.

### Codegen

In the `Configuration_*` constructor, STruC++ already initializes each
`TaskInstance`. Add the affinity:

```cpp
tasks_storage[0] = TaskInstance(
    "FASTTASK",      // name
    10000000LL,      // interval (T#10ms)
    80,              // priority
    &task_programs_storage[0],
    1,               // program_count
    0x03ULL          // NEW — cpu_affinity (16#03 = bits 0+1)
);
```

When `CPU_AFFINITY` is omitted from the source, codegen emits `0ULL` for
the field.

### Runtime accessor

The runtime reads `task.cpu_affinity_mask` directly via virtual dispatch
on `ConfigurationInstance*`. There is **no** new C-linkage accessor —
this is consistent with Phase 5's "walk the configuration directly"
philosophy.

The Phase 6 task-thread code branches on the mask:

```cpp
if (task->cpu_affinity_mask != 0) {
    cpu_set_t cs;
    CPU_ZERO(&cs);
    for (int cpu = 0; cpu < 64 && cpu < CPU_SETSIZE; ++cpu) {
        if (task->cpu_affinity_mask & (1ULL << cpu)) CPU_SET(cpu, &cs);
    }
    if (pthread_setaffinity_np(pthread_self(), sizeof cs, &cs) != 0) {
        log_warn("[task %s] pthread_setaffinity_np failed: %s",
                 task->name, strerror(errno));
    }
}
// else: no syscall, kernel scheduler decides freely.
```

## Editor (Resource Screen) — Future, Not Required

The runtime works as soon as STruC++ supports `CPU_AFFINITY` in the
parser. Editor UI to set affinity per task on the Resource configuration
screen is a follow-up; users who need it before the UI lands can edit
the `.st` directly.

## Sharedness Analysis Pseudocode

```
shared_vars = {
    every located variable in the project,
    every VAR_GLOBAL at CONFIGURATION or RESOURCE scope,
}

# Forward-resolve VAR_EXTERNAL references back to their owning VAR_GLOBAL.

for each function or function block FB:
    if any statement in FB reads or writes a variable in shared_vars:
        FB.touches_shared = true
    elif FB calls another function/FB that touches_shared:
        FB.touches_shared = true
    else:
        FB.touches_shared = false

for each program/task body:
    if program.touches_shared:
        emit `IMAGE_TABLES_LOCK_GUARD();` at the top of run()
    else:
        emit nothing
```

The fixed-point iteration over the call graph terminates because the
graph is acyclic for ST programs (no recursion in IEC 61131-3) plus the
function-block call graph forms a DAG.

For first-cut implementation, a coarser approximation is acceptable:
"emit `IMAGE_TABLES_LOCK_GUARD()` for every task body unconditionally".
This is correct (just over-locking) and lets the runtime side ship before
the precise analysis is done. The cost is minor — the lock is per-task,
held briefly. The precise analysis is a perf optimization that can land
later without changing the wire ABI.

## Files Modified (STruC++ side)

| File | Action |
|------|--------|
| `src/parser/parser.ts` (or wherever the `TASK` parameter rule lives) | Accept `CPU_AFFINITY := <int_literal>` as an optional third parameter |
| `src/project-model.ts` (or equivalent) | Add `cpuAffinityMask: bigint` to the task model; default 0 |
| `src/backend/codegen.ts` | Emit `cpu_affinity_mask` in `TaskInstance` constructor argument list (always — defaults to 0 when omitted) |
| `src/backend/codegen.ts` | Run sharedness analysis; emit `IMAGE_TABLES_LOCK_GUARD()` at the top of each task body that touches shared state (or unconditionally in first-cut mode) |
| `src/runtime/include/iec_std_lib.hpp` | Add `cpu_affinity_mask` field to `TaskInstance` struct (at the end, ABI-compatible) |
| `src/runtime/include/iec_threading.hpp` | **New** — defines `g_image_tables_mutex` and `IMAGE_TABLES_LOCK_GUARD()` macro under `STRUCPP_THREADING` |
| `src/runtime/include/iec_std_lib.hpp` | `#include "iec_threading.hpp"` so generated code picks up the macro automatically |

## Files Modified (runtime / editor side)

| File | Action |
|------|--------|
| `openplc-runtime/scripts/compile.sh` | Add `-DSTRUCPP_THREADING=1` to the C++ flags so the macro expands |
| `openplc-runtime/core/src/plc_app/plc_state_manager.cpp` | Phase 6's task thread reads `task->cpu_affinity_mask` and only calls `pthread_setaffinity_np` when non-zero |

## Testing Strategy

1. **Lock guard zero-cost on Arduino**: compile a project with
   `STRUCPP_THREADING` undefined (Arduino target). Verify `objdump -d`
   shows no atomic instructions or library calls inside task bodies; the
   macro must be a true no-op at the assembly level.
2. **Lock guard correctness on Linux**: two-task project, both writing
   to a shared `VAR_GLOBAL` counter. Run for 1M iterations across both
   tasks. Final counter value matches expected sum (no torn writes, no
   lost updates).
3. **Lock-free path**: task body that touches no located/global variable
   under the precise sharedness analysis. Verify `nm` / `objdump`
   confirms no lock symbols referenced from that task's `run()`.
4. **`CPU_AFFINITY` parsing**: feed STruC++ a `.st` file with
   `CPU_AFFINITY := 16#03`; check the generated `TaskInstance` literal
   contains `0x3` in the right position. Repeat with no `CPU_AFFINITY`
   and verify it emits `0`.
5. **`CPU_AFFINITY` runtime application**: on Linux, declare two tasks
   with disjoint affinities (`16#01` for one, `16#02` for the other);
   verify with `taskset -p` (or `/proc/<tid>/status`) that each thread
   is pinned to the requested CPU.
6. **`CPU_AFFINITY` default**: declare a task without `CPU_AFFINITY`;
   verify the runtime makes no `pthread_setaffinity_np` syscall (e.g.,
   via `strace -e trace=sched_setaffinity`).
