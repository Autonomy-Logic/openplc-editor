/*
modbus_registers.h - Modbus operation function codes
Copyright (C) 2022 OpenPLC - Thiago Alves

The standard Modbus operation FCs (0x01-0x10), served straight from the process
image through openplc_image_* — this layer holds no register bank of its own.
Compiled only under MODBUS_ENABLED; a debug-only build never references these
symbols, because the debugger reads IEC variables through the strucpp debug
table instead. The `modbus` instance itself lives in modbus_frame.* because its
slave id is shared by every build.
*/

#ifndef MODBUS_REGISTERS_H
#define MODBUS_REGISTERS_H

#include "modbus_frame.h"

// Read / write one discrete point of the image. `regtype` picks the area:
// COILS is %QX, INPUTSTATUS is %IX. An unbound point reads false and swallows
// the write.
bool get_discrete(uint16_t addr, bool regtype);
void write_discrete(uint16_t addr, bool regtype, bool value);

//Modbus operation function-code handlers
void readRegisters(uint16_t startreg, uint16_t numregs);
void writeSingleRegister(uint16_t reg, uint16_t value);
void writeMultipleRegisters(uint16_t startreg, uint16_t numoutputs, uint8_t bytecount);
void readCoils(uint16_t startreg, uint16_t numregs);
void readInputStatus(uint16_t startreg, uint16_t numregs);
void readInputRegisters(uint16_t startreg, uint16_t numregs);
void writeSingleCoil(uint16_t reg, uint16_t status);
void writeMultipleCoils(uint16_t startreg, uint16_t numoutputs, uint16_t bytecount);

#endif
