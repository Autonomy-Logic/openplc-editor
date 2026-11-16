// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_MASTER_UTIL_H
#define MODBUS_MASTER_UTIL_H

#include <stdint.h>

/** Whether `now` has reached `when`, across a millis() or micros() wrap. */
static inline bool reached(uint32_t now, uint32_t when)
{
    return (int32_t)(now - when) >= 0;
}

/** Store `value` big-endian at `p`. */
static inline void put16(uint8_t *p, uint16_t value)
{
    p[0] = (uint8_t)(value >> 8);
    p[1] = (uint8_t)value;
}

/** The big-endian 16-bit value at `p`. */
static inline uint16_t get16(const uint8_t *p)
{
    return (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
}

#endif
