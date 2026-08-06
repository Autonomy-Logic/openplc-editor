/*
modbus_registers.h - Modbus register store + operation function codes
Copyright (C) 2022 OpenPLC - Thiago Alves

The coil/holding/input register banks and the standard Modbus operation FCs
(0x01-0x10). Compiled only under MODBUS_ENABLED — a debug-only build never
references these symbols (the debugger reads IEC variables directly through the
strucpp debug table, needing no operation buffers). The `modbus` instance itself
lives in modbus_frame.* because its slave id is shared by every build.
*/

#ifndef MODBUS_REGISTERS_H
#define MODBUS_REGISTERS_H

#include "modbus_frame.h"

bool init_mbregs(uint8_t size_holding, uint8_t size_dint_memory, uint8_t size_lint_memory, uint8_t size_coils, uint8_t size_inputregs, uint8_t size_inputstatus);
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
