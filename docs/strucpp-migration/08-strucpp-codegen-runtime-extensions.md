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

### The macros

STruC++ emits two macros at codegen sites that touch shared state:

- `IMAGE_TABLES_LOCK_GUARD()` — locks the image-tables resource
- `GLOBAL_VARS_LOCK_GUARD()` — locks the globals resource

Both live in a strucpp runtime header (`iec_threading.hpp`):

```cpp
// iec_threading.hpp — strucpp runtime header

#pragma once

#if defined(STRUCPP_THREADING)             // defined by compile.sh on Linux
    #include <pthread.h>

    namespace strucpp {
        // Pointers to mutexes OWNED BY THE RUNTIME. The runtime calls
        // strucpp_set_locks() right after dlopen to plumb them in.
        // Plain pthread_mutex_t (not std::mutex) so we can use
        // PTHREAD_PRIO_INHERIT + PTHREAD_MUTEX_RECURSIVE.
        extern pthread_mutex_t* g_image_tables_mutex_ptr;
        extern pthread_mutex_t* g_global_vars_mutex_ptr;

        struct ImageTablesLockGuard {
            pthread_mutex_t* m;
            ImageTablesLockGuard() : m(g_image_tables_mutex_ptr) {
                if (m) pthread_mutex_lock(m);
            }
            ~ImageTablesLockGuard() {
                if (m) pthread_mutex_unlock(m);
            }
            ImageTablesLockGuard(const ImageTablesLockGuard&) = delete;
            ImageTablesLockGuard& operator=(const ImageTablesLockGuard&) = delete;
        };

        struct GlobalVarsLockGuard {
            pthread_mutex_t* m;
            GlobalVarsLockGuard() : m(g_global_vars_mutex_ptr) {
                if (m) pthread_mutex_lock(m);
            }
            ~GlobalVarsLockGuard() {
                if (m) pthread_mutex_unlock(m);
            }
            GlobalVarsLockGuard(const GlobalVarsLockGuard&) = delete;
            GlobalVarsLockGuard& operator=(const GlobalVarsLockGuard&) = delete;
        };
    }

    #define IMAGE_TABLES_LOCK_GUARD() \
        ::strucpp::ImageTablesLockGuard _strucpp_itlg_
    #define GLOBAL_VARS_LOCK_GUARD()  \
        ::strucpp::GlobalVarsLockGuard  _strucpp_gvlg_

#else
    // Arduino (and any other single-threaded target): zero overhead.
    // Same source compiles unchanged.
    #define IMAGE_TABLES_LOCK_GUARD() ((void)0)
    #define GLOBAL_VARS_LOCK_GUARD()  ((void)0)
#endif
```

`STRUCPP_THREADING` is defined by `compile.sh` on Linux and not on
Arduino. The same `generated.cpp` ships everywhere.

### One mutex per resource — no duplicates

There is **one** image-tables mutex in the system, **one** globals
mutex. Both are owned by the runtime (initialized with priority
inheritance and recursion via `init_rt_mutex()`-style helpers). The .so
borrows pointers to them via the `strucpp_set_locks()` setter the .so
exposes:

```cpp
// runtime_v4_entry.cpp — runtime-side shim, in openplc-runtime
//
// In addition to strucpp_get_config(), the shim exports a setter the
// runtime calls right after dlopen to wire the resource mutexes in:

#include "iec_threading.hpp"

namespace strucpp {
    pthread_mutex_t* g_image_tables_mutex_ptr = nullptr;
    pthread_mutex_t* g_global_vars_mutex_ptr  = nullptr;
}

extern "C" void strucpp_set_locks(pthread_mutex_t* image_tables,
                                  pthread_mutex_t* global_vars) {
    strucpp::g_image_tables_mutex_ptr = image_tables;
    strucpp::g_global_vars_mutex_ptr  = global_vars;
}
```

The runtime, in `image_tables_bind_located_vars()` or earlier in the
load sequence, dlsyms `strucpp_set_locks` and calls it with pointers to
the runtime's existing `buffer_mutex` (image tables) and a new
`global_vars_mutex` (introduced in this phase, lives next to
`buffer_mutex` in the plugin driver or `plc_state_manager`).

Result: the same mutex object is locked from both sides — codegen-emitted
guards inside user code and runtime-side housekeeping wrappers — no
risk of two threads thinking they're protected when they're locking
different objects.

### Why pthread_mutex_t and not std::mutex

The runtime needs **priority-inheriting** mutexes for jitter-bounded RT
scheduling, and **recursive** mutexes so the fastest-task housekeeping
window can hold the lock across `cycle_start` + body + `cycle_end`
without the body's codegen-emitted guard deadlocking on its own thread.
`std::mutex` exposes neither attribute portably; the underlying
`pthread_mutex_t` does:

```c
pthread_mutexattr_t attr;
pthread_mutexattr_init(&attr);
pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT);
pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE);
pthread_mutex_init(&buffer_mutex, &attr);
pthread_mutexattr_destroy(&attr);
```

The lock guards above use the raw pthread API directly. Same RAII
properties, just no `std::mutex` wrapper.

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

Concretely, the codegen emits one or both guards based on what the
task body touches:

```cpp
// Body that touches BOTH image tables and globals:
void Program_MAIN::run() {
    IMAGE_TABLES_LOCK_GUARD();   // canonical order: image-tables first
    GLOBAL_VARS_LOCK_GUARD();    // canonical order: globals second
    // ... reads %IW0, writes GLOBAL_COUNTER ...
}

// Body that touches ONLY image tables:
void Program_IO_ONLY::run() {
    IMAGE_TABLES_LOCK_GUARD();
    // ... %IW0, %QX0.0, %MW10 ...
}

// Body that touches ONLY globals:
void Program_LOGIC_ONLY::run() {
    GLOBAL_VARS_LOCK_GUARD();
    // ... GLOBAL_STATE := GLOBAL_FLAG ...
}

// Body that touches NEITHER — no guard, runs fully lock-free
void Program_PURE_COMPUTE::run() {
    // ... only local variables and FB internals ...
}
```

Tasks with no shared access run **fully lock-free** in parallel on
multi-core. That's the whole point of granular locking.

Phase 7's housekeeping wrapper (the fastest task's `plc_run_io_cycle_pre`
+ `plc_run_io_cycle_post`) takes only the image-tables lock — it
doesn't touch globals. If the fastest task's body also has a
`GLOBAL_VARS_LOCK_GUARD()`, that guard is acquired AFTER the
image-tables one (canonical order preserved across the
runtime+codegen boundary).

The journal-drain call lives inside the runtime's housekeeping wrapper,
not inside generated code, but it runs under the same image-tables
mutex the codegen guards lock against — so plugin writes drained from
the journal land in the image table while no other task body can be
mid-read.

### Plugin-side use

Plugins call `cycle_start` / `cycle_end` from the fastest IEC task's
thread (Phase 7 anchor). The fastest-task thread holds the
image-tables lock around the housekeeping window, so plugin hooks run
with the lock already taken. Plugins that want to additionally grab the
lock from internal threads (e.g., EtherCAT's monitor thread) include
`iec_threading.hpp` and use `IMAGE_TABLES_LOCK_GUARD()` directly —
same primitive, same mutex object, recursive PI semantics let them
re-enter safely.

### Lock ordering

When a task body touches both image tables and globals, codegen emits
the guards in **canonical order**:

1. `IMAGE_TABLES_LOCK_GUARD()` first
2. `GLOBAL_VARS_LOCK_GUARD()` second

```cpp
void Program_MAIN::run() {
    IMAGE_TABLES_LOCK_GUARD();   // image-tables first
    GLOBAL_VARS_LOCK_GUARD();    // globals second
    // ... body ...
}
```

Same order on every site means no AB/BA deadlock is possible. The
runtime's housekeeping wrapper (Phase 7's `plc_run_io_cycle_pre/post`)
takes only the image-tables lock — it doesn't touch globals. The body
inside the housekeeping window may re-acquire the image-tables lock
recursively (cheap) and may also acquire the globals lock — all in the
same canonical order.

### Globals mutex: single vs per-variable

The image-tables mutex is the runtime's existing one — there's no
choice about its granularity. The globals mutex is new with this phase,
and there's a real decision to make about it.

| Approach | Pros | Cons |
|---|---|---|
| **Single mutex for all globals** *(recommended for first cut)* | Simple. No lock ordering, no memory bloat (one mutex regardless of project size). Identical pattern to the image-tables mutex. | All globals access serializes through one lock. Two tasks that touch *different* globals at the same instant block each other. |
| **One mutex per global variable** | True parallelism: tasks accessing disjoint globals don't contend. | Memory: ~40 bytes per `pthread_mutex_t` × N globals = noticeable bloat for projects with many globals. Lock ordering: codegen must enumerate every global a task touches and lock in canonical (e.g., address-order) sequence to avoid deadlock. Static analysis must be **precise** — a false negative (failing to enumerate a touched global) becomes a data race. |
| **One mutex per RESOURCE** | Cheap (typically 1–4 mutexes per project). Resource-scoped globals are independent by definition; CONFIGURATION-scoped globals fall into a single shared-mutex bucket. | Codegen complexity: a task that references a CONFIGURATION-level global plus a RESOURCE-level global must lock two mutexes in canonical order. |

**Recommendation: start with a single globals mutex.** Most PLC programs
declare a small number of globals, and accesses to them are bursty and
brief — the lock is held for microseconds at a time. If profiling on a
real workload identifies the globals mutex as a contention bottleneck,
the per-resource approach is a small follow-up; the per-variable
approach is a much larger investment that should not be paid until
measurements demand it.

The doc and codegen below assume the single-mutex approach. The
`g_global_vars_mutex_ptr` symbol stays the same regardless of
granularity choice; only the runtime's mutex storage and the codegen's
lock-emission policy change.

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

The lock guards are NULL-pointer-safe at the per-instance level —
`ImageTablesLockGuard` constructed before `strucpp_set_locks()` runs
sees a null `m` and skips both the lock and unlock. This is mostly a
defense for tests / harnesses that load the .so without going through
the full runtime initialization path. In production the runtime always
calls `strucpp_set_locks` before any task thread starts.

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

The analysis classifies each task body into one of four buckets:
**neither**, **image-tables-only**, **globals-only**, **both**.
Different buckets get different macros emitted.

```
image_table_vars = { every located variable in the project }
global_vars      = { every VAR_GLOBAL at CONFIGURATION or RESOURCE scope }

# Forward-resolve VAR_EXTERNAL references back to their owning VAR_GLOBAL.

for each function or function block FB:
    FB.touches_image_tables = false
    FB.touches_globals      = false
    for each statement in FB:
        if statement reads/writes any var in image_table_vars:
            FB.touches_image_tables = true
        if statement reads/writes any var in global_vars:
            FB.touches_globals = true
    for each callee of FB (transitively, until fixed point):
        FB.touches_image_tables ||= callee.touches_image_tables
        FB.touches_globals      ||= callee.touches_globals

for each program/task body P:
    if P.touches_image_tables: emit IMAGE_TABLES_LOCK_GUARD() at top of run()
    if P.touches_globals:      emit GLOBAL_VARS_LOCK_GUARD()  at top of run()
    # Order matters: image-tables guard before globals guard. ALWAYS.
```

The fixed-point iteration over the call graph terminates because the
graph is acyclic for ST programs (no recursion in IEC 61131-3) plus the
function-block call graph forms a DAG.

For first-cut implementation, a coarser approximation is acceptable:
"emit BOTH `IMAGE_TABLES_LOCK_GUARD()` and `GLOBAL_VARS_LOCK_GUARD()`
for every task body unconditionally". This is correct (just
over-locking) and lets the runtime side ship before the precise
analysis is done. The cost is minor — locks are per-task and held
briefly. The precise analysis is a perf optimization that lands later
without changing the wire ABI.

## Files Modified (STruC++ side)

| File | Action |
|------|--------|
| `src/parser/parser.ts` (or wherever the `TASK` parameter rule lives) | Accept `CPU_AFFINITY := <int_literal>` as an optional third parameter |
| `src/project-model.ts` (or equivalent) | Add `cpuAffinityMask: bigint` to the task model; default 0 |
| `src/backend/codegen.ts` | Emit `cpu_affinity_mask` in `TaskInstance` constructor argument list (always — defaults to 0 when omitted) |
| `src/backend/codegen.ts` | Run sharedness analysis; emit `IMAGE_TABLES_LOCK_GUARD()` and `GLOBAL_VARS_LOCK_GUARD()` at the top of each task body in canonical order (image-tables first, globals second) — or unconditionally emit both in first-cut mode |
| `src/runtime/include/iec_std_lib.hpp` | Add `cpu_affinity_mask` field to `TaskInstance` struct (at the end, ABI-compatible) |
| `src/runtime/include/iec_threading.hpp` | **New** — declares `g_image_tables_mutex_ptr` / `g_global_vars_mutex_ptr` (extern); defines `ImageTablesLockGuard` / `GlobalVarsLockGuard` and the corresponding macros under `STRUCPP_THREADING`; macros expand to `((void)0)` otherwise |
| `src/runtime/include/iec_std_lib.hpp` | `#include "iec_threading.hpp"` so generated code picks up the macros automatically |

## Files Modified (runtime / editor side)

| File | Action |
|------|--------|
| `openplc-runtime/scripts/compile.sh` | Add `-DSTRUCPP_THREADING=1` to the C++ flags so the macros expand |
| `openplc-runtime/core/strucpp_runtime/runtime_v4_entry.cpp` | Define `strucpp::g_image_tables_mutex_ptr` / `g_global_vars_mutex_ptr` storage; export `extern "C" void strucpp_set_locks(pthread_mutex_t*, pthread_mutex_t*)` setter |
| `openplc-runtime/core/src/plc_app/plc_state_manager.cpp` | Initialize a new `global_vars_mutex` (recursive PI mutex) alongside the existing `buffer_mutex` (image tables); after dlopen, dlsym `strucpp_set_locks` and pass both pointers in. Phase 6's task thread reads `task->cpu_affinity_mask` and only calls `pthread_setaffinity_np` when non-zero |
| `openplc-runtime/core/src/plc_app/utils/utils.c` | Update `init_rt_mutex()` (or add a sibling) so it can build a recursive PI mutex (existing helper builds non-recursive PI; needs the additional `pthread_mutexattr_settype(... PTHREAD_MUTEX_RECURSIVE)` step) |

## Testing Strategy

1. **Lock guard zero-cost on Arduino**: compile a project with
   `STRUCPP_THREADING` undefined (Arduino target). Verify `objdump -d`
   shows no `pthread_mutex_*` calls or atomic instructions inside task
   bodies; both macros must be true no-ops at the assembly level.
2. **Same mutex on both sides on Linux**: harness loads the .so,
   confirms `strucpp::g_image_tables_mutex_ptr` (read via dlsym) equals
   the address of the runtime's `buffer_mutex` after `strucpp_set_locks`
   is called. Same for `g_global_vars_mutex_ptr`.
3. **Image-tables lock correctness**: two tasks write to a shared `%MW`
   counter via `IEC_LOC.MW10 := IEC_LOC.MW10 + 1`. 1 M iterations
   across both tasks; final value matches expected sum (no torn writes,
   no lost updates).
4. **Globals lock correctness**: two tasks bump a `VAR_GLOBAL` counter
   the same way. Same expected-vs-actual check.
5. **Lock-ordering soak**: a third task body that touches both image
   tables and globals; runs alongside the first two for a long period.
   Confirm no AB/BA deadlock under stress.
6. **Lock-free path**: task body that touches no located/global variable
   under the precise sharedness analysis. Verify `nm` / `objdump`
   confirms no `pthread_mutex_*` calls referenced from that task's
   `run()`.
7. **Recursive locking by the fastest task**: under stress, confirm
   that the fastest task's `plc_run_io_cycle_pre/post` window holds
   the image-tables mutex while the body's
   `IMAGE_TABLES_LOCK_GUARD()` re-acquires it; the body completes
   without deadlock and lock counter returns to zero on housekeeping
   exit.
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
