// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_CRC_H
#define MODBUS_CRC_H

#include "modbus_types.h"

// CRC-16 (Modbus) over mb_frame[0 .. mb_frame_len-2] — i.e. the whole frame except the trailing two CRC bytes.
uint16_t calcCrc();

/** CRC-16 (Modbus) of `len` bytes at `data`, high byte first as calcCrc() returns it:
 *  the frame carries the high byte, then the low one. Touches no shared frame state. */
uint16_t mb_crc16(const uint8_t *data, uint16_t len);

#endif
