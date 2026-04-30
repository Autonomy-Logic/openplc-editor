# Phase 7: Plugin Worker Threads

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
> 3. **Current draft.** Both options are gone. Option A coupled the
>    plugin tick rate to whatever IEC priority happened to be highest,
>    spread "task 0 is special" assumptions across the codebase, and
>    couldn't accommodate plugins with very different cycle requirements
>    (a 1 ms EtherCAT exchange vs. a 100 ms slow Modbus poll). Option B
>    was an unimplemented placeholder. Replaced with: each native plugin
>    runs on its own worker thread with priority + cycle interval +
>    affinity from per-plugin config.

## Goal

Move all plugin cyclic work — `cycle_start`, `cycle_end`, anything
plugin-internal that wants to run periodically — onto **per-plugin
worker threads** owned and scheduled by the plugin driver, independent
of any IEC task. Each plugin sets its own priority, period, and CPU
affinity through its config file. IEC tasks become pure compute: they
run user code, drain the journal at the top of their bodies inside the
image-tables lock guard (emitted by STruC++ in Phase 8), and have no
direct relationship with any plugin.

## Prerequisites

- Phase 5 (runtime → C++; `.so` interface settled) — done in this branch
- Phase 6 (thread-per-task) — done in this branch (CPU-affinity default
  fix per Phase 6 revision)
- Phase 8 (`IMAGE_TABLES_LOCK_GUARD()` codegen) — informally relied on
  here; can ship Phase 7 with a coarse runtime-side mutex first if Phase
  8 lands later, then drop the coarse mutex when codegen catches up

## What "Plugin Worker Thread" Means Concretely

For every native plugin that registers `cycle_start` and/or `cycle_end`,
the plugin driver spawns one pthread:

```
Plugin worker thread iteration (period = config.cycle_interval_ns):

    # outside the image-tables lock — plugin-internal work, fieldbus I/O,
    # protocol state machines, etc. Plugins should keep this section short
    # to minimize wall-clock latency, not because of any lock contention.

    plugin->cycle_start_ext()            # external I/O read

    # then atomically publish into the image table via the journal —
    # journal_write_*() takes its own short-lived lock on the journal
    # queue, NOT the image-tables lock. The image tables themselves are
    # not touched here; IEC tasks pick up the writes at their next drain.

    journal_write_int(addr, value);
    journal_write_bool(addr, value);
    ...

    plugin->cycle_end_ext()              # protocol acks etc.

    clock_nanosleep(..., next_wakeup);
```

For plugins like EtherCAT that already have an internal monitor thread
for connection lifecycle, the new worker thread is **the** thread that
runs the cyclic exchange. The monitor thread continues to handle
out-of-band events (link up/down, slave reset, etc.) and does not
participate in the cycle.

## Plugin Config Schema Additions

`plugins.conf` (or per-plugin `<name>.conf` — whichever is the existing
mechanism) gains three optional fields:

```ini
# plugins/native/ethercat/ethercat.conf

cycle_interval_ns = 1000000      # 1 ms — fast fieldbus
rt_priority       = 80           # SCHED_FIFO 80 — higher than typical PLC tasks
                                 # so I/O completes before user code reads
cpu_affinity      = 0x04         # bit 2 — pin to CPU 2; 0 = kernel decides
```

Defaults (when a field is missing):

| Field | Default | Rationale |
|---|---|---|
| `cycle_interval_ns` | `10000000` (10 ms) | Reasonable middle ground; matches the GCD of typical PLC programs |
| `rt_priority` | `25` | Below typical IEC task priorities (which sit ~30–80) so user code can preempt I/O if it needs to. Plugins that need to finish I/O before user code sees stale data should explicitly set a higher priority. |
| `cpu_affinity` | `0` | No pinning, kernel decides |

The runtime side validates: `rt_priority` clamped to 1..99 with a
warning when out-of-range; `cycle_interval_ns` rejected if zero or
negative; `cpu_affinity` reset to 0 if the bitmask references CPUs
beyond `nproc`.

## Runtime-Side Spawning

```cpp
// In plugin_driver_start() — runs on the bootstrap thread, after
// image_tables_bind_located_vars() and journal_init().

for (size_t i = 0; i < plugin_count; ++i) {
    plugin_t* p = &plugins[i];
    if (!p->cycle_start && !p->cycle_end) continue;   // nothing to schedule

    p->worker.cycle_interval_ns = p->config.cycle_interval_ns;
    p->worker.rt_priority       = p->config.rt_priority;
    p->worker.cpu_affinity_mask = p->config.cpu_affinity;
    p->worker.alive             = true;
    atomic_init(&p->worker.heartbeat, (long)time(NULL));

    if (pthread_create(&p->worker.thread, NULL,
                       plugin_worker_thread, p) != 0) {
        log_error("[%s] failed to spawn worker thread: %s",
                  p->name, strerror(errno));
        plc_force_error_state();
        return;
    }
}
```

The plugin worker thread's body looks structurally identical to
Phase 6's `plc_task_thread` — same `clock_nanosleep(CLOCK_MONOTONIC,
TIMER_ABSTIME)` absolute-deadline scheduler, same per-thread `sigsetjmp`
crash handler, same SCHED_FIFO + optional affinity setup. It just calls
the plugin's `cycle_start_ext` / `cycle_end_ext` instead of an IEC
task body.

## Tear-Down

`plugin_driver_stop()` flips `p->worker.alive = false`, signals SIGUSR1
to wake any worker blocked in `clock_nanosleep`, and joins each worker
thread. After all workers are joined, plugin-internal teardown
(`plugin_cleanup`, etc.) runs on the bootstrap thread.

The order is:

1. Set `plc_state` to `STOPPING` (existing path).
2. Signal + join **task threads** (Phase 6's existing teardown).
3. Signal + join **plugin worker threads**.
4. Plugin cleanup callbacks.
5. Image-tables clear, plugin manager destroy.

Tasks join first because they may be holding the image-tables lock
during their last cycle; plugin workers may be enqueueing journal
entries. Both must drain to a quiescent state before image tables and
journal storage are torn down.

## IEC Tasks: What They Do Now

```cpp
// plc_task_thread loop (Phase 6 + Phase 7 + Phase 8)

while (plc_state == PLC_STATE_RUNNING) {
    /* IMAGE_TABLES_LOCK_GUARD() is emitted by STruC++ around the task body
     * in Phase 8 if the task touches any located/global variable.
     * Tasks that touch nothing shared run lock-free.
     *
     * journal_apply_and_clear() is called at the start of every task
     * that drains shared state. Calling it more than once per "cycle"
     * is harmless — second drain finds an empty queue and returns. */
    {
        IMAGE_TABLES_LOCK_GUARD();      // expands to lock_guard<mutex> on Linux,
                                        // no-op on Arduino
        journal_apply_and_clear();      // see notes below
        ext_strucpp_run_task(ctx->idx); // → ConfigurationInstance virtual dispatch
    }

    /* heartbeat + sleep_until — same as Phase 6 */
}
```

**The journal-drain location is fully inside the lock.** Any plugin
worker that enqueues during the lock window contends only on the journal
queue's own mutex (which is different from the image-tables mutex), so
plugin throughput isn't blocked by user code execution.

**No `updateTime` call here.** Time advancement runs once per "scan" —
but with multiple tasks at multiple periods, "once per scan" isn't
defined. Resolution:

- A **separate dedicated time-tick thread** (very lightweight — wakes
  every `min(task_intervals)`, calls `strucpp::__CURRENT_TIME_NS += period`,
  sleeps).
- Alternative: each task increments `__CURRENT_TIME_NS` by its own
  interval at the start of its body. Simpler, and matches CODESYS's
  per-cycle time semantics — `TIME()` returns the same value within a
  scan, and that scan is the task's. STruC++'s `IEC_TIME` semantics
  hold: a `TON` running in a 10 ms task sees 10 ms increments;
  a `TON` in a 100 ms task sees 100 ms increments.

Going with the second option (per-task increment). It's more correct
than a single global tick when tasks have different periods, and it
eliminates a thread.

## Watchdog

The watchdog's job stays the same: detect a hung PLC and force the
runtime into ERROR state so the webserver can keep talking to it. The
heartbeats it tracks change:

| Heartbeat | Source | Stall threshold | What a stall means |
|---|---|---|---|
| Task heartbeat | `plc_tasks[i].heartbeat`, set at the end of every task body in `plc_task_thread` | `WATCHDOG_TASK_TIMEOUT_S` (default 10 s) | An IEC task is stuck — infinite loop, deadlock, or busy plugin holding the image-tables lock |
| Plugin worker heartbeat | `plugins[i].worker.heartbeat`, set at the end of every worker iteration | `WATCHDOG_PLUGIN_TIMEOUT_S` (default 5 s, configurable) | The plugin's `cycle_start`/`cycle_end` is stuck — fieldbus failure, blocking I/O, etc. |

When any heartbeat goes silent past its threshold, the watchdog logs
which entity stalled (task name or plugin name) and calls
`plc_force_error_state()`. There's no longer a global "I/O heartbeat"
because there's no global "I/O thread" — plugin workers each have their
own.

## Migration Path for Existing Plugins

| Plugin | Current state | Phase 7 work |
|---|---|---|
| EtherCAT (native) | Has a monitor thread for connection lifecycle; cycle_start/end run on the PLC thread today | Move cycle_start/end onto a new worker thread; keep the monitor thread. Add `cycle_interval_ns` (default match the existing master cycle) and `rt_priority` to its config |
| S7Comm (native) | Cycle hooks on the PLC thread | Same: move to worker thread |
| OPC UA (Python) | Server thread already independent; consumed flat-index `get_var_*` API removed in Phase 5 | **No worker thread needed** — OPC UA is event-driven (clients poll). Migration is the Phase 9 work (move from flat-index API to `strucpp_debug_*`). |
| Modbus master / slave (native, if applicable) | Whatever the current loop is | Move to worker thread |

Plugins that don't register `cycle_start` / `cycle_end` (e.g., OPC UA)
don't get a worker thread spawned for them — they continue to run their
own threads (HTTP server, async clients, etc.) as today. The worker
thread is specifically for the cyclic-hook protocol.

## Files Created / Modified

| File | Action |
|------|--------|
| `core/src/drivers/plugin_driver.h` | Add `plugin_worker_t` struct (thread, heartbeat, alive flag, config snapshot); add fields to `plugin_t` |
| `core/src/drivers/plugin_driver.c` | New `plugin_worker_thread()`; update `plugin_driver_start()` to spawn workers; update `plugin_driver_stop()` to signal + join workers |
| `core/src/drivers/plugin_config.c` | Parse `cycle_interval_ns`, `rt_priority`, `cpu_affinity` from per-plugin config files |
| `core/src/plc_app/plc_state_manager.cpp` | **Remove** the bootstrap I/O loop (the per-revision-2 collapse to "just spawn + wait" stays); `journal_apply_and_clear` no longer called here |
| `core/src/plc_app/plc_io_cycle.{h,cpp}` | **Delete** — no I/O cycle wrapper anymore. Tasks drain the journal themselves; plugin workers fire their hooks themselves |
| `core/src/plc_app/utils/watchdog.c` | Add per-plugin heartbeat scan; rename `plc_heartbeat` semantics in comments (it's now task-0-heartbeat-only or removed entirely) |
| `plugins.conf` (or per-plugin configs) | Document new `cycle_interval_ns`, `rt_priority`, `cpu_affinity` fields with their defaults |

## Testing Strategy

1. **Two-plugin smoke test**: configure EtherCAT (1 ms / pri 80) and a
   slow Modbus master (50 ms / pri 25). Verify both worker threads tick
   at their configured intervals (within ±10% over a 60-second window)
   and that EtherCAT preempts Modbus when their cycles align.
2. **Plugin priority preemption**: deliberate 5 ms busy loop in Modbus's
   `cycle_start`; EtherCAT's deadline must still hold (within ±50 µs).
   Test inverts the priorities (EtherCAT 25, Modbus 80) and verifies the
   inverse ordering, confirming priorities flow from config.
3. **Plugin worker crash**: deliberate SIGFPE in EtherCAT's `cycle_end`;
   the per-thread `sigsetjmp` catches it, the runtime transitions to
   ERROR, the IEC task threads exit cleanly. Webserver still responds.
4. **Watchdog plugin stall**: 30-second `sleep(30)` inside a worker;
   watchdog reports `[ethercat] worker stalled` and forces ERROR state
   within `WATCHDOG_PLUGIN_TIMEOUT_S` of the freeze.
5. **Stop responsiveness**: while running with a 1000 ms slow plugin
   worker, call `stop_plc_program()`; total teardown time < 1100 ms
   (one period — SIGUSR1 wakes the sleeper).
6. **Journal contention**: stress test with one plugin worker writing
   100 journal entries per cycle and three IEC tasks each draining the
   journal at their start. No torn reads, no leaked entries, no
   deadlock.
