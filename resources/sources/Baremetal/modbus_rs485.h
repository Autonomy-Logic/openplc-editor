// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_RS485_H
#define MODBUS_RS485_H

#include <stdint.h>

#include "modbus_config.h"

/** Prepare the direction control of `port`: `pin` (none when negative) as an output
 *  driven low, and the board's own transceiver on `port`, if any, initialised. */
void mb_rs485_init(Stream *port, int16_t pin);

/** Drive `pin` high to transmit or low to receive; nothing when `pin` is negative. */
void mb_rs485_pin(int16_t pin, bool transmit);

/** Switch the board's own transceiver on `port` to transmit or to receive; nothing
 *  when the board has none on that port. */
void mb_rs485_board(Stream *port, bool transmit);

#endif
