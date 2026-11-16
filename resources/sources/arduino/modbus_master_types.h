// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
#ifndef MODBUS_MASTER_TYPES_H
#define MODBUS_MASTER_TYPES_H

#include <Arduino.h>
#include <stdint.h>

// Transport of a device: which table its link index points into.
#define MB_MASTER_TCP 0u
#define MB_MASTER_RTU 1u

// RS-485 enable pin of a bus that drives none.
#define MB_MASTER_NO_PIN (-1)

// Parity of an RTU bus.
#define MB_PARITY_N 0u
#define MB_PARITY_E 1u
#define MB_PARITY_O 2u

// What a group's points hold while its device does not answer.
#define MB_ERR_KEEP 0u
#define MB_ERR_ZERO 1u

// IEC image area of a point.
#define MB_IMG_IX 0u
#define MB_IMG_IW 1u
#define MB_IMG_QX 2u
#define MB_IMG_QW 3u

// One TCP connection, shared by every device on the same address and port.
typedef struct
{
    uint8_t ip[4];
    uint16_t port;
    uint32_t timeout_ms;
    uint8_t reconnect;
} mb_master_endpoint_t;

// One RTU bus on a board UART, shared by every device on that UART.
typedef struct
{
    HardwareSerial *uart;
    uint32_t baud;
    uint8_t parity;
    uint8_t stop_bits;
    uint8_t data_bits;
    uint32_t timeout_ms;
    int16_t rs485_pin;
} mb_master_bus_t;

// One remote device: its transport, the endpoint or bus index, and its slave id.
typedef struct
{
    uint8_t transport;
    uint16_t link;
    uint8_t slave_id;
} mb_master_device_t;

// One polled register range; its points are `length` entries of the points table from `first_point`.
typedef struct
{
    uint16_t device;
    uint8_t fc;
    uint16_t offset;
    uint32_t length;
    uint32_t cycle_ms;
    uint8_t on_error;
    uint32_t first_point;
} mb_master_group_t;

// One IEC location a register or coil maps to: word or byte index, and bit for the bit areas.
typedef struct
{
    uint8_t image;
    uint16_t index;
    uint8_t bit;
} mb_master_point_t;

#endif
