# Phase 7: Plugin Hooks, Journal, and I/O Coordination

> **Revision note** — this slot used to host "Native hierarchical debug
> handler". That work has been folded into Phase 5 (the runtime speaks
> hierarchical from day one — no flat-index transition path). The slot is now
> used for the question Phase 6 deliberately leaves open: where do plugin
> cycle hooks, journal application, and `updateTime()` live in the
> thread-per-task world?

## Goal

Decide where plugin `cycle_start` / `cycle_end`, `journal_apply_and_clear`,
and `updateTime` run after the runtime is split into per-task threads.
Document the contract so that:

- Plugins keep working with the same authoring model they have today (one
  `cycle_start` and one `cycle_end` per "scan").
- Time-related IEC functions (`TON`, `TOF`, `TP`, current time blocks) get a
  consistent base tick and don't see double-increments.
- The journal's "apply pending writes between scans" guarantee survives the
  shift from one cycle thread to N task threads.

## Prerequisites

- Phase 5 — `.so` interface and `updateTime` symbol
- Phase 6 — task-per-thread spawning (the per-task thread function leaves
  cycle hooks unwired by design)

## The two viable topologies

### Option A: ride task 0 (highest priority)

The highest-priority task's thread plays double duty: before its program
body runs, it calls `journal_apply_and_clear` and
`plugin_driver_cycle_start`; after, it calls `plugin_driver_cycle_end` and
`updateTime`. Other tasks just run their own bodies.

```
Task 0 (highest priority) iteration:
    take(buffer_mutex)
    journal_apply_and_clear()
    plugin_driver_cycle_start()
    strucpp_run_task(0)
    updateTime()
    plugin_driver_cycle_end()
    give(buffer_mutex)

Task k (k > 0) iteration:
    take(buffer_mutex)
    strucpp_run_task(k)
    give(buffer_mutex)
```

**Pros**

- No new threads, no new mutexes.
- Plugin authors see the same model they have today.
- `__CURRENT_TIME` advances by `interval_ns` of task 0 each cycle — the
  highest-frequency tick on the system.
- Watchdog has a single anchor (task 0 heartbeat) for "is the I/O loop
  alive?" semantics.

**Cons**

- I/O update rate is fixed to task 0's period. If the user declares a 1 ms
  task, plugins have to keep up. (Real-world projects rarely have hot tasks
  faster than the I/O can sustain anyway, so this is more of a sharp-edge
  warning than a real defect.)
- If task 0 is stuck (e.g., busy-waiting on shared state), I/O freezes.

### Option B: dedicated I/O coordinator thread

A separate "I/O coordinator" thread runs at priority `max(task priorities) + 1`
(or, if 99 is already used, `max - 1` — whichever stays inside SCHED_FIFO
range). Its only job is the per-cycle I/O work; tasks never touch plugins.

```
I/O coordinator iteration (period = min(task interval_ns, configured floor)):
    take(buffer_mutex)
    journal_apply_and_clear()
    plugin_driver_cycle_start()
    plugin_driver_cycle_end()
    updateTime()
    give(buffer_mutex)

Task k iteration (any k):
    take(buffer_mutex)
    strucpp_run_task(k)
    give(buffer_mutex)
```

**Pros**

- I/O cadence is independent of any IEC task period. The user can choose it
  via `OPENPLC_IO_INTERVAL_NS` or default to `min(interval_ns)` across tasks.
- Cleaner separation: tasks compute, coordinator does I/O.
- A stuck task can't freeze I/O — the coordinator still runs.

**Cons**

- One more thread, one more priority allocation, more complex teardown.
- Plugin authors who rely on "cycle_start runs immediately before my POU"
  see a slightly weaker contract: cycle_start runs immediately before *some*
  POU runs, not theirs specifically.
- `updateTime` is no longer aligned with any specific IEC task's period —
  the coordinator's interval drives `__CURRENT_TIME`.

## Recommendation: Option A first, with a clean upgrade path to B

We ship Option A in the initial cut. It matches what plugins see today and
introduces no new threads. We pay back the design later by adding Option B
behind an `OPENPLC_IO_COORDINATOR=1` env flag if real workloads demand it.

The contract that lets us swap implementations later:

- The runtime exposes a single function pointer, `plc_run_io_cycle()`,
  invoked under `buffer_mutex`. Option A has the task 0 thread call it;
  Option B has the coordinator thread call it. The function body
  (`journal_apply_and_clear` + plugin hooks + `updateTime`) is identical.

```c
/* core/src/plc_app/plc_io_cycle.c */

void plc_run_io_cycle(PluginDriver* pd) {
    journal_apply_and_clear();
    plugin_driver_cycle_start(pd);
    /* program bodies have already run (Option A) or will run independently
     * (Option B). plc_run_io_cycle is the I/O wrapper around that. */
    ext_updateTime();
    plugin_driver_cycle_end(pd);
}
```

## Wire-up for Option A

The Phase 6 thread function gets a tiny conditional for `ctx->idx == 0`:

```c
while (plc_get_state() == PLC_STATE_RUNNING) {
    ctx->holding_mutex = 1;
    plugin_mutex_take(&plugin_driver->buffer_mutex);

    if (ctx->idx == 0) {
        journal_apply_and_clear();
        plugin_driver_cycle_start(plugin_driver);
    }

    ext_strucpp_run_task(ctx->idx);

    if (ctx->idx == 0) {
        ext_updateTime();
        plugin_driver_cycle_end(plugin_driver);
    }

    plugin_mutex_give(&plugin_driver->buffer_mutex);
    ctx->holding_mutex = 0;

    /* heartbeat + sleep_until — same as Phase 6 */
}
```

`__CURRENT_TIME` advances by `task[0].interval_ns` each cycle, which matches
the highest-frequency tick on the system. This is consistent with the
single-thread runtime (where `common_ticktime__` was the GCD of all task
intervals — typically the same as the fastest task interval).

## Tick semantics

The single-thread runtime had `tick__++` driving `config_run__(tick__)` and
`updateTime` saw `common_ticktime__` worth of nanoseconds per increment.

In thread-per-task we do **not** maintain a global `tick__`. Each task has
`atomic_uint_least64_t local_tick` (Phase 6). `updateTime` uses
`common_ticktime__` which the `.so` exposes as the GCD of declared intervals
(same value Arduino computes); under Option A the coordinator advances
`__CURRENT_TIME` by `task[0].interval_ns` per cycle, which equals
`common_ticktime__` whenever task 0 is the fastest task — the typical case.

For projects where task 0 isn't the fastest (e.g., user declared an unusual
priority/interval combination), `__CURRENT_TIME` runs at task 0's rate. We
log a one-time warning at startup if `task[0].interval_ns > min(interval_ns)`
so the operator notices.

## Journal buffer contract

`journal_apply_and_clear()` drains the queue of pending writes from plugins
into the image table. It must run **between** task bodies, never during.
Since Option A acquires `buffer_mutex` before applying the journal and
releases it after the program body runs, the existing "apply between scans"
guarantee holds — for task 0's scans. Task k>0 sees the journal contents
applied by the most recent task 0 iteration; this is fine because journal
writes are commutative-by-target (each write replaces the previous value
for that address) and plugins already tolerate scan-quantized application.

If a project has a slow task 0 (e.g., 1000 ms) and a fast task k (e.g., 10
ms), the journal will only drain every 1000 ms. That's a regression from
the single-thread model where the journal drained every base tick. Mitigate
in two ways:

1. Document this clearly. Operators who need fast plugin updates should set
   their highest-priority task to a small interval, even if it has minimal
   work to do.
2. As a follow-up (not in this phase): allow the I/O coordinator (Option B)
   to run at a fixed period independent of tasks.

## Watchdog

Watchdog uses the per-task `heartbeat` array introduced in Phase 6. The "is
I/O alive?" question is answered by task 0's heartbeat specifically (since
Option A puts I/O on task 0). The "is any task stuck?" question is answered
by `max(now - heartbeat[i])` across all tasks.

```c
/* watchdog snapshot, runs at 1 Hz from a separate thread */
long now = (long)time(NULL);
long io_lag   = now - atomic_load(&plc_tasks[0].heartbeat);
long max_lag  = io_lag;
size_t worst  = 0;
for (size_t i = 1; i < plc_task_count; ++i) {
    long lag = now - atomic_load(&plc_tasks[i].heartbeat);
    if (lag > max_lag) { max_lag = lag; worst = i; }
}

if (io_lag > IO_TIMEOUT_S) {
    log_error("watchdog: I/O cycle stalled (%lds since last heartbeat)", io_lag);
    plc_set_state(PLC_STATE_ERROR);
}
if (max_lag > TASK_TIMEOUT_S) {
    log_error("watchdog: task %zu stalled (%lds since last heartbeat)",
              worst, max_lag);
    plc_set_state(PLC_STATE_ERROR);
}
```

`IO_TIMEOUT_S` defaults to 5 s; `TASK_TIMEOUT_S` to 10 s. Both are tunable
via env vars for slow tasks.

## Files Created / Modified

| File | Action |
|------|--------|
| `core/src/plc_app/plc_io_cycle.c` | New – `plc_run_io_cycle` wrapper |
| `core/src/plc_app/plc_io_cycle.h` | New – signature |
| `core/src/plc_app/plc_state_manager.c` | Modified – task 0 calls `plc_run_io_cycle` (Option A) |
| `core/src/plc_app/watchdog.c` (or wherever the watchdog lives today) | Modified – iterate per-task heartbeats |

## Testing Strategy

1. **Plugin smoke test**: dummy plugin that increments a counter in
   `cycle_start` and another in `cycle_end`. Run with two tasks (10 ms / 100
   ms); verify both counters tick at task 0's rate (10 ms ⇒ 100 ticks/s).
2. **Journal application order**: plugin writes alternating values to a
   register on every `cycle_start`; PLC program reads it in task 0's body.
   Verify task 0 sees each write exactly once and never reads a value that
   was overwritten before it ran.
3. **Slow task 0**: declare task 0 at 1000 ms, task 1 at 10 ms. Verify task 1
   continues running at 10 ms (Option A's known limitation: I/O update at
   1000 ms; task 1 sees stale plugin data between drains, but its own
   computation runs at the right rate).
4. **Watchdog with stuck plugin**: deliberate `sleep(30)` inside `cycle_end`;
   verify watchdog reports "I/O cycle stalled" and PLC enters ERROR state.
5. **Watchdog with stuck task**: deliberate `sleep(30)` inside a non-task-0
   POU; verify watchdog reports the right `task k` index and PLC enters
   ERROR state.
6. **Option B preview** (not shipped): if `OPENPLC_IO_COORDINATOR=1`, spawn
   the coordinator thread and skip the task 0 inline path. Smoke-test that
   I/O still ticks. (Behind a flag, not enabled by default.)
