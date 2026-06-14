# Phase 6: Thread-Per-Task Model for Runtime v4

> **Revision note (1).** This doc was first rewritten after Phase 3/4
> (Arduino) shipped. The old draft assumed an "old single-threaded
> round-robin .so" and a "new per-task .so" coexisting in the runtime.
> We're not carrying that forward — Phase 5 already eliminates the
> single-threaded path (no `config_run__`). Thread-per-task is the only
> mode the new runtime supports.
>
> **Revision note (2).** Two changes follow from the Phase 5 rewrite
> (runtime → C++) and the Phase 8 codegen extensions:
>
> 1. **No more C-linkage `strucpp_get_task_*` accessors.** The runtime
>    walks `ConfigurationInstance*` via virtual dispatch; per-task data
>    (name, interval, priority, affinity) is read straight from the
>    `TaskInstance` struct.
> 2. **CPU affinity defaults to "no pinning".** The previous revision
>    pinned task `i` to CPU `i mod nproc` round-robin — that was always
>    a placeholder. With Phase 8 adding `CPU_AFFINITY` to `TASK`
>    declarations, affinity comes from the user program. When unset,
>    `pthread_setaffinity_np` is **not** called and the kernel decides.
>
> **Revision note (3, current).** Phase 7 was reverted from "plugin
> worker threads" to "anchor housekeeping on the fastest IEC task".
> One small change here: each `PlcTaskCtx` gains an `is_fastest_task`
> boolean. The thread function branches on it to run the housekeeping
> window pre/post its body. Selection rule: lowest `interval_ns`,
> tie-break by highest `priority`, then by declaration order.

## Goal

Each declared IEC task runs on its own POSIX thread under SCHED_FIFO with a
priority derived from the task's declared priority. Threads coordinate access
to shared state through a single `buffer_mutex` (granular per-variable locking
is a later optimization).

## Prerequisites

- Phase 5 (.so interface, `strucpp_get_task_count` / `strucpp_run_task` etc.)
- Linux runtime at `~/Documents/Code/openplc-runtime`

## What thread-per-task buys us (and what it doesn't)

It is worth being honest about this up front. With a single `buffer_mutex`
serializing every task body, **threads do not run their computation in
parallel**. What we do get:

1. **Period accuracy per task.** Each task wakes on its own
   `clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME)` deadline; a slow task no
   longer drags fast tasks. Jitter is bounded by per-task wake-up precision,
   not by the GCD of all task intervals.
2. **Priority-driven preemption.** SCHED_FIFO ensures that when a high-priority
   task becomes runnable, the kernel preempts a sleeping low-priority task
   instantly. The mutex is priority-inheriting (already used today via
   `init_rt_mutex` in `utils.c`), so a low-priority task holding the mutex
   inherits the highest waiter's priority while it runs — no priority
   inversion stalls.
3. **Independent crash isolation.** A SIGFPE in one task takes down only that
   task's thread; the others continue until the runtime tears them all down
   in response to the resulting `PLC_STATE_ERROR`.

What it does **not** buy:

- True parallel execution of task bodies. That requires either lock-free
  shared-state access or per-variable locking — both are future work and
  benefit from the same `.so` interface.
- A free lunch on multi-core: most PLC programs are I/O-bound and dominated
  by per-task period, not compute, so this rarely matters.

## Architecture overview

```
                   +-------------- I/O coordinator ---------------+
                   | (highest-priority task drives plugin hooks,  |
                   |  see Phase 7 for the alternative dedicated   |
                   |  coordinator-thread topology)                |
                   +----------------------------------------------+
                              |
+------------------+    +-----+-------+    +------------------+
| Task 0 (highest) |    | Task 1      |    | Task N           |
| pri 50, 10ms     |    | pri 30, 50ms|    | pri 10, 1000ms   |
| SCHED_FIFO       |    | SCHED_FIFO  |    | SCHED_FIFO       |
+--------+---------+    +------+------+    +--------+---------+
         |                     |                    |
         +--------- buffer_mutex (PRIO_INHERIT) ----+
                              |
                          image tables,
                          VAR_GLOBAL state,
                          plugin journals
```

## Task indexing

The runtime spawns task threads in the order STruC++ emits them in
`ConfigurationInstance` (declaration order from the `.st` file). There is
no priority-sorted contract; SCHED_FIFO + the priority on each task's
`sched_param` decides who actually runs.

**One task is marked as the "fastest task"** before threads are spawned,
and that mark drives the housekeeping window in Phase 7. Selection:

1. Smallest positive `interval_ns` wins.
2. If multiple tasks tie on interval, the one with the highest priority
   wins.
3. If they also tie on priority, declaration order breaks the tie (first
   one in `ConfigurationInstance` wins).

If two tasks share a priority *and* an interval, the kernel
round-robins between them within that priority band — same as any
other SCHED_FIFO setup. The "fastest" mark goes to one of them
deterministically per the rules above.

## Thread descriptor

```c
/* core/src/plc_app/plc_state_manager.h */

#include "runtime_v4_entry.h"  /* C-linkage LocatedVar / TaskInfo */
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>

typedef struct {
    size_t      idx;             /* index into plc_tasks[] */
    int64_t     interval_ns;
    int         priority;        /* IEC TASK priority, mapped 1..99 */
    uint64_t    cpu_affinity_mask; /* 0 = no pinning, kernel decides */
    bool        is_fastest_task; /* this thread runs the housekeeping window */
    pthread_t   thread;
    char        name[32];        /* "plc-task-<n>" for /proc visibility */

    /* Per-thread state — must NOT be shared across threads */
    sigjmp_buf  crash_jmp;
    volatile int crash_sig;
    int         holding_mutex;   /* set inside the critical section */

    /* Heartbeat for the watchdog. The watchdog checks max(time(NULL) - hb)
     * across all task threads — a single hung task is enough to trip it. */
    atomic_long heartbeat;

    /* Cycle stats, per-task */
    atomic_uint_least64_t local_tick;
    atomic_long           last_overrun_ns;
} PlcTaskCtx;

extern PlcTaskCtx *plc_tasks;   /* heap-allocated array, plc_task_count entries */
extern size_t      plc_task_count;
```

Per-thread state (`crash_jmp`, `crash_sig`, `holding_mutex`) lives **inside the
context struct**, not in file-scope globals. The old single-thread code path
relied on a single `crash_jmp_buf` global; that doesn't work with multiple
threads. Each task's `crash_jmp` is private to its own thread.

## Thread function

```c
/* core/src/plc_app/plc_state_manager.c */

static void* plc_task_thread(void* arg) {
    PlcTaskCtx* ctx = (PlcTaskCtx*)arg;

    /* /proc visibility for debugging */
    pthread_setname_np(pthread_self(), ctx->name);

    /* Real-time priority. Map IEC priority (often 0..100) to SCHED_FIFO
     * (1..99), clamping at the edges. */
    int rt_prio = ctx->priority;
    if (rt_prio < 1)  rt_prio = 1;
    if (rt_prio > 99) rt_prio = 99;
    struct sched_param sp = { .sched_priority = rt_prio };
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0) {
        log_warn("[task %s] could not set SCHED_FIFO (priority %d): %s — "
                 "running at default priority. RT quota / capabilities?",
                 ctx->name, rt_prio, strerror(errno));
    }

    /* CPU affinity — only applied if the user supplied one in the .st via
     * Phase 8's CPU_AFFINITY parameter. A zero mask means "kernel decides"
     * and we make no syscall. */
    uint64_t affinity_mask = task->cpu_affinity_mask;  /* from TaskInstance */
    if (affinity_mask != 0) {
        cpu_set_t cs;
        CPU_ZERO(&cs);
        for (int cpu = 0; cpu < CPU_SETSIZE && cpu < 64; ++cpu) {
            if (affinity_mask & (1ULL << cpu)) CPU_SET(cpu, &cs);
        }
        if (pthread_setaffinity_np(pthread_self(), sizeof cs, &cs) != 0) {
            log_warn("[task %s] pthread_setaffinity_np failed: %s",
                     ctx->name, strerror(errno));
        }
    }

    /* Per-thread crash recovery. */
    install_per_thread_crash_handlers(ctx);
    if (sigsetjmp(ctx->crash_jmp, 1) != 0) {
        if (ctx->holding_mutex) {
            ctx->holding_mutex = 0;
            plugin_mutex_give(&plugin_driver->buffer_mutex);
        }
        log_error("[task %s] crashed (signal %d) — entering ERROR state",
                  ctx->name, ctx->crash_sig);
        plc_set_state(PLC_STATE_ERROR);
        return NULL;
    }

    /* Initialize timing. */
    struct timespec next_wakeup;
    clock_gettime(CLOCK_MONOTONIC, &next_wakeup);

    while (plc_get_state() == PLC_STATE_RUNNING) {
        ctx->holding_mutex = 1;
        plugin_mutex_take(&plugin_driver->buffer_mutex);

        /* Phase 7 inserts plugin hooks here for ctx->idx == 0. The bare
         * thread-per-task model just runs the task body. */
        ext_strucpp_run_task(ctx->idx);

        plugin_mutex_give(&plugin_driver->buffer_mutex);
        ctx->holding_mutex = 0;

        atomic_store_explicit(&ctx->heartbeat, (long)time(NULL),
                              memory_order_relaxed);
        atomic_fetch_add_explicit(&ctx->local_tick, 1,
                                  memory_order_relaxed);

        /* Sleep until next period. */
        next_wakeup.tv_nsec += (long)(ctx->interval_ns % 1000000000LL);
        next_wakeup.tv_sec  += (time_t)(ctx->interval_ns / 1000000000LL);
        if (next_wakeup.tv_nsec >= 1000000000L) {
            next_wakeup.tv_nsec -= 1000000000L;
            next_wakeup.tv_sec  += 1;
        }
        int rc = clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME,
                                 &next_wakeup, NULL);
        if (rc == EINTR) continue; /* shutdown signal will flip state */
    }

    log_info("[task %s] stopped after %llu ticks", ctx->name,
             (unsigned long long)atomic_load(&ctx->local_tick));
    return NULL;
}
```

`install_per_thread_crash_handlers(ctx)` is a thin wrapper that uses
`pthread_sigmask` + `sigaction(SA_SIGINFO)` and stashes the `PlcTaskCtx*` in
thread-local storage so the signal handler can `siglongjmp` to the right
`crash_jmp`. Implementation lives in `utils.c` next to the existing
`init_rt_mutex` helpers.

## Lifecycle

### Spawn

`load_plc_program()` resolves the new symbols, calls `config_init__()`, walks
`locatedVars[]` to bind image tables (Phase 5), then spawns one thread per
task:

```c
size_t n = ext_strucpp_get_task_count();
plc_tasks = calloc(n, sizeof(PlcTaskCtx));
plc_task_count = n;

for (size_t i = 0; i < n; ++i) {
    PlcTaskCtx* ctx = &plc_tasks[i];
    ctx->idx          = i;
    ctx->interval_ns  = ext_strucpp_get_task_interval_ns(i);
    ctx->priority     = ext_strucpp_get_task_priority(i);
    snprintf(ctx->name, sizeof ctx->name, "plc-task-%zu", i);
    atomic_init(&ctx->heartbeat,  (long)time(NULL));
    atomic_init(&ctx->local_tick, 0);

    if (pthread_create(&ctx->thread, NULL, plc_task_thread, ctx) != 0) {
        log_error("Failed to spawn task %zu: %s", i, strerror(errno));
        plc_set_state(PLC_STATE_ERROR);
        return;
    }
}
```

If a task has `interval_ns <= 0` (continuous/event-driven, not yet supported),
log a warning and skip it. If after spawning, no tasks were created, transition
to `PLC_STATE_ERROR`.

### Stop

```c
void stop_plc_program(void) {
    plc_set_state(PLC_STATE_STOPPING);

    /* SIGUSR1 wakes any task currently blocked in clock_nanosleep so the
     * EINTR path lets them observe the new state. We mask SIGUSR1 in the
     * threads' signal mask elsewhere so it isn't accidentally handled. */
    for (size_t i = 0; i < plc_task_count; ++i) {
        pthread_kill(plc_tasks[i].thread, SIGUSR1);
    }
    for (size_t i = 0; i < plc_task_count; ++i) {
        pthread_join(plc_tasks[i].thread, NULL);
    }

    free(plc_tasks);
    plc_tasks = NULL;
    plc_task_count = 0;
    plc_set_state(PLC_STATE_STOPPED);
}
```

### Watchdog

The watchdog (separate thread, already exists today) iterates the task array
once per second and checks `time(NULL) - max(heartbeat)`. If any task hasn't
ticked in `WATCHDOG_TIMEOUT_S` seconds, it logs which task is stuck and
transitions to `PLC_STATE_ERROR`.

## Mapping IEC priority to SCHED_FIFO

IEC 61131-3 doesn't fix the priority range. Most editors emit 0..100. Linux
SCHED_FIFO is 1..99. We clamp:

```c
int rt = ctx->priority;
if (rt < 1)  rt = 1;
if (rt > 99) rt = 99;
```

If the runtime lacks `CAP_SYS_NICE` (e.g., running as a non-privileged user
inside a container without `--cap-add=SYS_NICE`), `pthread_setschedparam`
fails. We **log a warning and continue** at default scheduling — the task
still runs, just without RT preemption. Operational guidance: deployments
that need RT must grant the capability or use `rtprio` in
`/etc/security/limits.conf`.

## What this thread does

The thread function from this phase runs the **task body** and nothing
else. **Phase 7** specializes the fastest-task thread to additionally
wrap the body in a housekeeping window:

```cpp
// Phase 7 specialization — fastest task only
if (ctx->is_fastest_task) {
    plc_run_io_cycle_pre();   // journal_apply + plugin cycle_start
}
ext_strucpp_run_task(ctx->idx);
if (ctx->is_fastest_task) {
    plc_run_io_cycle_post();  // updateTime + plugin cycle_end + tick++
}
```

Non-fastest tasks just run the body. See Phase 7 for the full wire-up.

## Files Created / Modified

| File | Action |
|------|--------|
| `core/src/plc_app/plc_state_manager.c` | Rewritten – thread-per-task spawning + per-thread crash handler |
| `core/src/plc_app/plc_state_manager.h` | Modified – `PlcTaskCtx`, exports |
| `core/src/plc_app/utils.c` / `.h` | Modified – `install_per_thread_crash_handlers`, `lock_memory`, TLS for per-task ctx |
| `core/src/plc_app/image_tables.c` | Modified (in Phase 5) – walks `locatedVars[]` directly |

## Testing Strategy

1. **Single-task program**: spawns one thread, runs at the declared interval.
   Validate `pthread_getschedparam` returns `SCHED_FIFO` and the right priority.
2. **Two-task program (10 ms / 100 ms, priorities 50 / 30)**: both threads tick
   at their declared intervals (within ±10% over a 60-second window).
3. **Priority preemption**: induce a 5-ms busy loop in the low-priority task;
   verify the high-priority task still meets its deadline. Compare against a
   non-RT control by running with `OPENPLC_DISABLE_TASK_AFFINITY=1` and
   without the `CAP_SYS_NICE` capability.
4. **Per-thread crash**: deliberately divide-by-zero in task 1; verify task 1
   thread exits cleanly via the `siglongjmp`, the runtime transitions to
   `PLC_STATE_ERROR`, and no other thread is stuck holding `buffer_mutex`.
5. **Watchdog**: sleep task 0 for 30 seconds inside the program; verify the
   watchdog transitions to `PLC_STATE_ERROR` and reports task 0 by name.
6. **Stop responsiveness**: while running with a 1000 ms task, call
   `stop_plc_program()`; verify the join completes in < 1100 ms (one period).
7. **macOS sandbox testing**: SCHED_FIFO and `pthread_setname_np` aren't
   available on macOS. Wrap them in `#ifdef __linux__` so the file at least
   compiles syntactically on macOS for development.
