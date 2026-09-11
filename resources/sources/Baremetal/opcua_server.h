/*
opcua_server.h - umbrella + scan-loop facade for the baremetal OPC-UA server
Copyright (C) 2026 Autonomy Logic

`Baremetal.ino` includes this and calls `opcuatask()` once per scan, the same
shape as `ModbusSlave.h` / `mbtask()`.  Everything below is compiled out when
the target's VPP does not declare `opcuaServer`, so this header is safe to
include unconditionally.
*/

#ifndef OPCUA_SERVER_H
#define OPCUA_SERVER_H

#include <stddef.h>
#include <stdint.h>

#include "opcua_config.h"

/** Bring the server up.  Safe to call when OPC-UA is disabled (no-op).
 *  Call AFTER the network layer is configured — see opcua_net.h. */
void opcua_init();

/** Service the server for at most `OPCUA_SCAN_BUDGET_US` microseconds.
 *
 *  Time-boxed on purpose.  The scan cycle is the contract with the user's
 *  program: a burst of OPC-UA traffic must never stretch it, so this returns
 *  with work still pending rather than finishing what it started.  Pending
 *  work is picked up next scan; the protocol is request/response over TCP and
 *  tolerates that latency, whereas a PLC whose cycle time wanders does not.
 */
/** Service the OPC-UA server for at most one event-loop iteration.
 *
 *  `slack_us` is how much of the current scan cycle is still unspent. The
 *  server runs ONLY if that exceeds its worst-case iteration cost, which is
 *  what keeps it from ever pushing a cycle past its deadline.
 *
 *  This is admission control, not a time-box, and the distinction is the whole
 *  point: `UA_Server_run_iterate()` is not preemptible, so a budget checked
 *  after the call can report an overrun but can never prevent one. Measured on
 *  a LOGO! 8.2, a single Read costs ~20 us on average but up to ~4.8 ms in the
 *  worst case, against a 20 ms cycle -- far too much to start speculatively
 *  near the end of a cycle. Deciding BEFORE the call is the only thing that
 *  actually bounds the damage. */
void opcuatask(uint32_t slack_us);

/** Scans in which opcuatask() hit its time budget and returned early.
 *
 *  Exposed rather than silently counted because "the OPC-UA server is
 *  stealing scan time" is otherwise invisible: the symptom is a slightly
 *  longer cycle, which looks like anything.  A non-zero and climbing value
 *  says the budget or the client load needs attention. */
uint32_t opcua_overrun_count();

#endif // OPCUA_SERVER_H
