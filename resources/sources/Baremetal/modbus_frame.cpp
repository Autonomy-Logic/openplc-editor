/*
modbus_frame.cpp - Shared Modbus message seam for the OpenPLC Modbus slave
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_frame.h"

//Global Modbus vars — the shared frame buffer and the slave/register struct.
struct MBinfo modbus;
uint8_t mb_frame[MAX_MB_FRAME];
uint16_t mb_frame_len;

void exceptionResponse(uint16_t fcode, uint16_t excode)
{
    //Clean frame buffer (leave only SlaveID)
    mb_frame_len = 3;
    for (int i = 0; i < mb_frame_len; i++) mb_frame[i] = 0;
    mb_frame[0] = modbus.slaveid;
    mb_frame[1] = fcode + 0x80;
    mb_frame[2] = excode;
}
