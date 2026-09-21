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
 *  Call AFTER the network layer is configured — see baremetal_net.h. */
void opcua_init();

/** Service the server for at most `OPCUA_SCAN_BUDGET_US` microseconds, returning
 *  with work still pending rather than stretching the scan cycle. Pending work
 *  is picked up next scan. */
/** Service the OPC-UA server for at most one event-loop iteration.
 *
 *  `slack_us` is how much of the current scan cycle is still unspent; the server
 *  runs only if that exceeds its worst-case iteration cost.
 *
 *  This is admission control, not a time-box: `UA_Server_run_iterate()` is not
 *  preemptible, so a budget checked after the call can report an overrun but
 *  never prevent one. Deciding before the call is the only thing that bounds it. */
void opcuatask(uint32_t slack_us);

/** Scans in which opcuatask() hit its time budget and returned early. Exposed
 *  rather than silently counted, because the symptom is otherwise just a
 *  slightly longer cycle. */
uint32_t opcua_overrun_count();

#endif // OPCUA_SERVER_H
