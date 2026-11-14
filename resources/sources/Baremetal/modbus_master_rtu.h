// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_MASTER_RTU_H
#define MODBUS_MASTER_RTU_H

#include "modbus_master.h"

#if MB_MASTER_ENABLED && MB_MASTER_RTU_ENABLED

/** Start every RTU bus afresh: on the first start its UART is begun with the bus's
 *  line settings and its RS-485 direction control prepared; nothing is in flight. A
 *  bus whose UART is the debugger's or the Modbus RTU server's, or whose line
 *  settings the core cannot apply, never polls and its read groups apply their
 *  error handling. */
void mb_master_rtu_start(void);

/** Abandon the request on every bus and return its RS-485 line to receive. */
void mb_master_rtu_stop(void);

/** One non-blocking pass over every bus: discard what the line holds before a
 *  send, send on an idle line without waiting for the UART, release the RS-485
 *  line once the request has left, take at most one buffer of the response,
 *  validate it and time it out. */
void mb_master_rtu_service(void);

#endif

#endif
