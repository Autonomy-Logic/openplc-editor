/*
modbus_frame.h - Shared Modbus message seam for the OpenPLC Modbus slave
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#ifndef MODBUS_FRAME_H
#define MODBUS_FRAME_H

#include "modbus_types.h"

// The one buffer every layer shares. A transport fills mb_frame[0..mb_frame_len),
// calls process_mbpacket() (which builds the response back into mb_frame), then
// writes it out. `modbus` carries the slave id — used in EVERY build, including
// debug-only — plus the operation register banks, which are allocated only when
// full Modbus is enabled (see modbus_registers.cpp under MODBUS_ENABLED).
extern struct MBinfo modbus;
extern uint8_t mb_frame[MAX_MB_FRAME];
extern uint16_t mb_frame_len;

// Build a Modbus exception response into mb_frame: [slaveid][fcode|0x80][excode].
void exceptionResponse(uint16_t fcode, uint16_t excode);

#endif
