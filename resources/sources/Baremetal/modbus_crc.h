/*
modbus_crc.h - Modbus RTU CRC-16 for the OpenPLC Modbus slave
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#ifndef MODBUS_CRC_H
#define MODBUS_CRC_H

#include "modbus_types.h"

// CRC-16 (Modbus) over mb_frame[0 .. mb_frame_len-2] — i.e. the whole frame
// except the trailing two CRC bytes. Reads the shared frame globals
// (mb_frame / mb_frame_len, declared in modbus_frame.h). The lookup tables are
// defined once in modbus_crc.cpp (they used to sit in the header, which risked
// one flash copy per translation unit).
uint16_t calcCrc();

#endif
