# Phase 7: Housekeeping on the Fastest IEC Task

> **Revision history.**
>
> 1. *First draft.* This slot used to host "Native hierarchical debug
>    handler" — work that got folded into Phase 5 once Arduino shipped
>    with hierarchical addressing on day one.
> 2. *Second draft.* Repurposed for "Plugin & I/O Coordination" with two
>    options: **Option A** "ride the highest-priority IEC task" and
>    **Option B** "dedicated coordinator thread behind an env flag".
>    Default was Option A — task 0's thread also drove
>    `journal_apply_and_clear`, plugin `cycle_start`/`cycle_end`, and
>    `updateTime`.
> 3. *Third draft.* Replaced Option A/B with **per-plugin worker
>    threads** owning their own priority and cycle interval via plugin
>    config. Each IEC task drained the journal independently.
> 4. **Current draft.** Unwound the plugin-worker-threads idea. The
>    smallest possible drift from the MatIEC-era runtime is "one thread
>    per IEC task, with the *fastest* one playing the role the
>    single-thread runtime's PLC thread used to play". The fastest task
>    drives `journal_apply_and_clear`, plugin `cycle_start`/`cycle_end`,
>    `updateTime`, and `tick__++` — same calls, same order, same
>    cadence the single-thread runtime had. No plugin worker threads.
>    No per-plugin config additions. Single-task projects are
>    behaviorally identical to the MatIEC era.

## Goal

Reproduce the MatIEC-era housekeeping schedule (one drain per scan, one
plugin cycle per scan, one `updateTime` per scan, one tick increment per
scan) on top of the thread-per-task model from Phase 6, by anchoring all
of it on the **fastest** IEC task's thread.

## Why "Fastest" Not "Highest Priority"

The single-thread runtime ran one scan at the GCD interval of all
declared tasks — i.e., at the *highest cadence* anybody asked for.
That's what plugins and I/O are designed around: data flows in and out
at scan rate, which is the highest rate of any user task.

Highest *priority* and highest *frequency* are usually the same task
(fast control loops are also typically declared with high priority for
jitter reasons), but they don't have to be. If they diverge, it's
frequency that matters for I/O — not priority. Anchoring on the
fastest-cadence task gives plugins exactly the tick rate they used to
have.

## Fastest-Task Selection

The runtime, after walking the configuration via virtual dispatch, picks
one task to mark as "fastest":

1. The task with the smallest positive `interval_ns` wins.
2. If multiple tasks tie on `interval_ns`, the one with the highest
   `priority` wins.
3. If they also tie on priority, declaration order breaks the tie (the
   first one STruC++ emits in `ConfigurationInstance` wins).

Concretely:

```cpp
// In plc_state_manager.cpp, right before spawning task threads:

PlcTaskCtx* fastest = nullptr;
for (size_t i = 0; i < plc_task_count; ++i) {
    PlcTaskCtx* c = &plc_tasks[i];
    if (!fastest ||
         c->interval_ns < fastest->interval_ns ||
        (c->interval_ns == fastest->interval_ns &&
         c->priority    > fastest->priority)) {
        fastest = c;
    }
}
fastest->is_fastest_task = true;
log_info("Anchoring housekeeping on task %s (interval=%lld ns, priority=%d)",
         fastest->name, (long long)fastest->interval_ns, fastest->priority);
```

Single-task projects: that one task is automatically the fastest. Its
thread does everything the single PLC thread used to do.

## What the Fastest Task's Thread Looks Like

```cpp
while (plc_get_state() == PLC_STATE_RUNNING) {
    /* Phase 8 codegen emits IMAGE_TABLES_LOCK_GUARD()/GLOBAL_VARS_LOCK_GUARD()
     * inside the task body (around individual variable accesses or around the
     * whole body, depending on the precision of the sharedness analysis).
     *
     * The runtime ALSO needs the image-tables lock for the housekeeping window
     * — journal apply + plugin hooks + updateTime — because they all touch
     * the same image-table buffers as the body. That outer lock uses the
     * SAME mutex Phase 8 emits against (recursive PI mutex), so a body that
     * re-locks during run_task is a quick lock-counter increment. */

    plc_image_tables_lock();             // outer: held across the whole window
    scan_cycle_time_start();

    /* Housekeeping pre */
    journal_apply_and_clear();
    plugin_driver_cycle_start(plugin_driver);

    /* Body — the fastest task's IEC code */
    ext_strucpp_run_task(ctx->idx);

    /* Housekeeping post */
    ext_updateTime();
    plugin_driver_cycle_end(plugin_driver);
    ++tick__;
    atomic_store(&plc_heartbeat, time(NULL));

    scan_cycle_time_end();
    plc_image_tables_unlock();

    atomic_store_explicit(&ctx->heartbeat, (long)time(NULL),
                          memory_order_relaxed);
    atomic_fetch_add_explicit(&ctx->local_tick, 1,
                              memory_order_relaxed);

    /* Sleep until next absolute deadline — same as Phase 6 */
    next_wakeup += ctx->interval_ns;
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_wakeup, NULL);
}
```

## What Non-Fastest Tasks Do

```cpp
while (plc_get_state() == PLC_STATE_RUNNING) {
    /* No journal drain, no plugin hooks, no updateTime, no tick++.
     * Just take the lock (or whatever Phase 8 codegen emits) and run the
     * body. The lock is held briefly because the body is the only thing
     * that touches shared state. */

    ext_strucpp_run_task(ctx->idx);

    atomic_store_explicit(&ctx->heartbeat, (long)time(NULL),
                          memory_order_relaxed);
    atomic_fetch_add_explicit(&ctx->local_tick, 1,
                              memory_order_relaxed);

    /* Sleep until next absolute deadline */
    next_wakeup += ctx->interval_ns;
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_wakeup, NULL);
}
```

The non-fastest task's lock acquisition is whatever Phase 8 emits
inside the task body (`IMAGE_TABLES_LOCK_GUARD()` /
`GLOBAL_VARS_LOCK_GUARD()`). It contends with the fastest task's outer
lock, so during the fastest task's housekeeping + body window, slower
tasks block on the mutex. After the fastest task releases, the slower
task's lock guard succeeds and it runs.

## Why This Doesn't Cause "Stale Reads" for Slower Tasks

The fastest task drains the journal every cycle. Plugin writes are
applied to image tables every fastest-task cycle. By the time a slower
task wakes up and runs, the image tables already reflect the most
recent plugin writes (give or take one fastest-task cycle, which is by
definition the smallest interval in the system).

For a 10 ms / 100 ms task pair: the slow task sees plugin data that's
at most 10 ms stale, every 100 ms when it runs. That's strictly better
than the MatIEC-era runtime, where the slow task would see data drained
once per 10 ms scan but only get to *act* on it every 100 ms anyway.

## Why This Doesn't Need a Per-Plugin Config

Plugins continue to expose `cycle_start` and `cycle_end`. The runtime
calls them at the fastest IEC task's cadence, which is the same rate
they used to be called at. No `cycle_interval_ns`, no `rt_priority`,
no `cpu_affinity` per plugin — there is nothing to schedule
separately. EtherCAT, Modbus master, S7Comm: they all keep their
existing implementations.

The only plugin behavior that changes is for plugins that internally
spawn their own threads (EtherCAT's monitor thread is the canonical
example). Those keep doing what they always did. The runtime doesn't
spawn anything *for* them.

## What if the User Wants Plugins at a Different Cadence?

The user creates an IEC task at the desired cadence. If the user wants
EtherCAT to tick at 1 ms but their main control loop is 10 ms, they
declare a 1 ms task — even an empty one — and the housekeeping
naturally moves to it. This is a deliberate design choice: the user
controls everything from one place (the `.st` file), and the runtime
has no separate scheduler to configure.

## Watchdog

The watchdog continues to track per-task heartbeats from Phase 6. The
fastest task's heartbeat doubles as the "I/O alive?" signal because
that's the thread doing the I/O work. There is no longer a separate
"plugin heartbeat" — there are no plugin worker threads to track.

```c
/* Watchdog logic — slight simplification of revision 3 */
for (size_t i = 0; i < plc_task_count; ++i) {
    long lag = now - atomic_load(&plc_tasks[i].heartbeat);
    if (lag > WATCHDOG_TASK_TIMEOUT_S) {
        log_error("watchdog: task %s stalled (%lds since heartbeat)",
                  plc_tasks[i].name, lag);
        plc_force_error_state();
    }
}
```

If the fastest task hangs (e.g., a plugin's `cycle_start` deadlocks),
its heartbeat goes silent, and the watchdog reports it by name. No
distinction between "the plugin is stuck" and "the task body is stuck"
— both manifest as the same task heartbeat going silent, and both
require an upload-correct-program response from the operator.

## Difference Tally vs. Revision 3

| Aspect | Revision 3 (plugin worker threads) | Revision 4 (fastest task anchor) |
|---|---|---|
| Plugin scheduling | Each plugin gets its own pthread | None — plugins called from fastest IEC task |
| Plugin config schema | Adds `cycle_interval_ns`, `rt_priority`, `cpu_affinity` per plugin | Unchanged from MatIEC era |
| Number of threads | N IEC tasks + M plugins + bootstrap | N IEC tasks + bootstrap |
| Single-task project behavior | Different from MatIEC (plugin runs on its own thread) | **Identical to MatIEC** |
| Journal drain | Each task drains independently | Only fastest task drains |
| `updateTime` ownership | Per-task (each increments by its own interval) | Fastest task only — same cadence as MatIEC era |
| `tick__` semantics | Per-task local tick + global atomic | Fastest task increments once per its cycle — same as MatIEC era |
| Watchdog | Per-task + per-plugin heartbeats | Per-task heartbeats only |

The "drift from MatIEC" budget is much smaller in revision 4. The price
is that plugins are forever tied to the fastest IEC task's cadence; if
that's a problem for some future plugin, the user creates a fast
empty task to anchor it. The benefit is far less moving machinery.

## Lock Ordering

Phase 8 emits two macros: `IMAGE_TABLES_LOCK_GUARD()` and
`GLOBAL_VARS_LOCK_GUARD()`. The fastest task's housekeeping window also
needs the image-tables lock. Both runtime-side and codegen-side acquire
locks in the same canonical order:

1. **Image-tables lock first**
2. **Globals lock second**

Codegen always emits in this order; the runtime's housekeeping wrapper
takes the image-tables lock only (the fastest task's body itself
re-acquires recursively if needed, plus the globals lock if needed).
Same order on every site means no AB/BA deadlock is possible.

Both mutexes are recursive priority-inheriting `pthread_mutex_t`
(initialized with `PTHREAD_MUTEX_RECURSIVE` + `PTHREAD_PRIO_INHERIT`),
so re-locking by a thread that already holds the lock (the fastest
task's body inside the housekeeping window) is a quick counter
increment. See Phase 8 for full details.

## Files Created / Modified

| File | Action |
|------|--------|
| `core/src/plc_app/plc_state_manager.cpp` | Add `is_fastest_task` field to `PlcTaskCtx`; pick the fastest task before spawning; the per-task thread function branches on it for the housekeeping window |
| `core/src/plc_app/plc_io_cycle.{h,cpp}` | **Re-introduce** (we deleted them in revision 3): `plc_run_io_cycle_pre()` does `journal_apply_and_clear` + `plugin_driver_cycle_start`; `plc_run_io_cycle_post()` does `updateTime` + `plugin_driver_cycle_end` + heartbeat + `tick__++`. Same shape as the second-revision draft, called only by the fastest task's thread |
| `core/src/plc_app/plc_state_manager.h` | Add `is_fastest_task : bool` to `PlcTaskCtx` |
| `core/src/drivers/plugin_driver.{h,c}` | **No changes for plugin scheduling.** (Plugins still register `cycle_start`/`cycle_end` the way they always did.) |
| `core/src/plc_app/utils/watchdog.c` | Drop per-plugin heartbeat scan added in revision 3; per-task is sufficient |
| `plugins.conf` (or per-plugin configs) | **No new fields.** Revert revision 3's `cycle_interval_ns` / `rt_priority` / `cpu_affinity` per-plugin schema |

## Testing Strategy

1. **Single-task project parity**: identical user `.st`, identical
   plugin configs. Runtime v4 (single-thread) vs runtime v4 (this
   phase) produce same observable behavior on a 30-minute soak — same
   plugin call cadence, same `tick__` rate, same I/O latency.
2. **Two-task project, fastest selection**: declare 10 ms / 100 ms.
   Verify the runtime log says "Anchoring housekeeping on task <10ms
   one>". Plugins tick at 100 Hz (the 10 ms cadence), not at 10 Hz.
3. **Tied intervals, priority breaks tie**: declare two tasks at 10 ms
   with priorities 80 and 30. The 80-priority one is the anchor.
4. **Plugin tick parity**: a counting plugin that increments a counter
   in `cycle_start`. After 10 seconds, with a 10 ms fastest task, the
   counter reads 1000 ± a few. Same as MatIEC era.
5. **Slower task non-stall**: 10 ms task takes 5 ms of CPU; 100 ms
   task takes 80 ms of CPU. Both meet their deadlines (10 ms cycle has
   5 ms slack; 100 ms cycle has 20 ms slack).
6. **Plugin in fastest task's hot path**: deliberate `sleep(30)` in a
   plugin's `cycle_start`. Watchdog reports `task <fastest> stalled`
   and forces ERROR within `WATCHDOG_TASK_TIMEOUT_S`.
