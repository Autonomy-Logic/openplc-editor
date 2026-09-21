/*
s7comm_server.h - the baremetal Siemens S7Comm server
Copyright (C) 2026 Autonomy Logic

Two calls, matching opcua_server.h's shape because they live the same life:
one from setup(), one from the scan loop.

Both compile to nothing when the project has no S7 server (S7COMM_ENABLED 0 in
the generated s7comm_config.h), so callers need no guard and a target that will
never run S7 pays nothing for it.
*/

#ifndef S7COMM_SERVER_H
#define S7COMM_SERVER_H

#include <stdint.h>

#include "s7comm_config.h"

/** Bring the server up: open port 102 and register the areas.
 *
 *  Call AFTER the network layer is configured -- see baremetal_net.h. Safe to
 *  call when S7 is disabled; it does nothing. */
void s7comm_init(void);

/** Service the server for at most the slack it is given.
 *
 *  `slack_us` is what remains of the current scan cycle. The server declines
 *  to start work it cannot finish inside that, EXCEPT once per sync interval,
 *  when it runs regardless -- see the scheduling comment in the .cpp for why a
 *  pure slack gate is a starvation bug and not a safety measure.
 *
 *  Never blocks on a peer. */
void s7commtask(uint32_t slack_us);

#endif // S7COMM_SERVER_H
