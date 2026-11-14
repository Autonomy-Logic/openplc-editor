// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_MASTER_TCP_H
#define MODBUS_MASTER_TCP_H

#include "modbus_master.h"

#if MB_MASTER_ENABLED && MB_MASTER_TCP_ENABLED

/** Start every TCP endpoint afresh: connect pending, retry and give-up state
 *  cleared, read groups on their error handling until the connection is up. */
void mb_master_tcp_start(void);

/** Close every TCP endpoint's connection, giving its socket back, and idle. */
void mb_master_tcp_stop(void);

/** One non-blocking pass over every endpoint: advance its connect or Reconnect
 *  wait, take what arrived (at most one buffer), time out the request in flight
 *  and send the next one. Connection failures follow the endpoint's Reconnect. */
void mb_master_tcp_service(void);

#endif

#endif
