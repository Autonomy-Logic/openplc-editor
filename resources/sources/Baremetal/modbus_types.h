/*
modbus_types.h - Shared type/constant declarations for the OpenPLC Modbus slave
Copyright (C) 2022 OpenPLC - Thiago Alves

Pure declarations only (enums, MBinfo, frame-size constants, status codes,
bit helpers). No storage, no functions — every Modbus TU includes this so the
protocol, transport, register and debug layers agree on the same contracts.
*/

#ifndef MODBUS_TYPES_H
#define MODBUS_TYPES_H

// Brings <Arduino.h>, the generated defines.h and the composite build gates
// (MB_SERIAL_ACTIVE, DEBUG_* defaults). Every modbus_* TU reaches defines.h
// through this single path — defines.h itself has no include guard.
#include "modbus_config.h"

#ifndef bitRead
    #define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#endif
//#define bitSet(value, bit) ((value) |= (1UL << (bit)))
//#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#ifndef bitWrite
    #define bitWrite(value, bit, bitvalue) (bitvalue ? bitSet(value, bit) : bitClear(value, bit))
#endif

#define COILS           0
#define INPUTSTATUS     1

#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__) || defined(__AVR_ATmega32U4__) || defined(__AVR_ATmega16U4__)
    #define MAX_MB_FRAME 128
#else
    #define MAX_MB_FRAME 256
#endif
#define MAX_SRV_CLIENTS 3 //how many clients should be able to connect to TCP server at the same time
#define MBAP_SIZE       6

// Status codes (match strucpp::debug::STATUS_* in debug_dispatch.hpp, kept
// as macros here so the Modbus layer doesn't have to include the C++
// runtime header when the rest of the protocol is C-style).
#define MB_DEBUG_SUCCESS                 0x7E
#define MB_DEBUG_ERROR_OUT_OF_BOUNDS     0x81
#define MB_DEBUG_ERROR_OUT_OF_MEMORY     0x82
// License storage semantic states. The editor distinguishes all three: EMPTY and
// CORRUPT both mean "recover from the backend", while UNSUPPORTED means the board
// cannot hold a license at all and buying one would not help. They don't collide
// with Modbus exceptions (0x01-0x04) nor 0x7E/0x81/0x82.
#define MB_DEBUG_LIC_EMPTY               0x83
#define MB_DEBUG_LIC_CORRUPT             0x84
// No license-store backend on this board (weak default): the licensing FCs
// degrade gracefully instead of failing as a transport error.
#define MB_DEBUG_LIC_UNSUPPORTED         0x85
// MB_FC_PLC_SET_STATE only: a RUN request was refused because the hardware mode
// switch reads STOP. The editor turns this into a "flip the switch to RUN"
// warning rather than a generic failure. It doesn't collide with Modbus
// exceptions (0x01-0x04) nor 0x7E/0x81/0x82.
#define MB_PLC_CTRL_REFUSED_SWITCH       0x86

//Modbus registers struct
struct MBinfo {
    uint8_t slaveid;
    uint16_t *holding;
    uint8_t holding_size;
    uint32_t *dint_memory;
    uint8_t dint_memory_size;
    uint64_t *lint_memory;
    uint8_t lint_memory_size;
    uint8_t *coils;
    uint8_t coils_size;
    uint16_t *input_regs;
    uint8_t input_regs_size;
    uint8_t *input_status;
    uint8_t input_status_size;
};

//Function Codes
enum {
    MB_FC_READ_COILS       = 0x01, // Read Coils (Output) Status 0xxxx
    MB_FC_READ_INPUT_STAT  = 0x02, // Read Input Status (Discrete Inputs) 1xxxx
    MB_FC_READ_REGS        = 0x03, // Read Holding Registers 4xxxx
    MB_FC_READ_INPUT_REGS  = 0x04, // Read Input Registers 3xxxx
    MB_FC_WRITE_COIL       = 0x05, // Write Single Coil (Output) 0xxxx
    MB_FC_WRITE_REG        = 0x06, // Preset Single Register 4xxxx
    MB_FC_WRITE_COILS      = 0x0F, // Write Multiple Coils (Outputs) 0xxxx
    MB_FC_WRITE_REGS       = 0x10, // Write block of contiguous registers 4xxxx
    MB_FC_DEBUG_INFO       = 0x41, // Request debug variables count
    MB_FC_DEBUG_SET        = 0x42, // Debug set trace (force variable)
    MB_FC_DEBUG_GET        = 0x43, // Debug get trace (read variables)
    MB_FC_DEBUG_GET_LIST   = 0x44, // Debug get trace list (read list of variables)
    MB_FC_DEBUG_GET_MD5    = 0x45, // Debug get current program MD5
    MB_FC_DEBUG_GET_STATUS = 0x46, // Debug get PLC status (running, scan tick, uptime)
    MB_FC_DEBUG_GET_VERSION = 0x47, // Debug get runtime firmware version
    MB_FC_DEBUG_GET_BOARD_ID = 0x48, // Debug get unique hardware board ID
    MB_FC_DEBUG_WRITE_LICENSE = 0x49, // Debug write license blob to on-device storage
    MB_FC_DEBUG_READ_LICENSE  = 0x4A, // Debug read license blob from on-device storage
    MB_FC_PLC_SET_STATE       = 0x4B, // Set the runtime run/stop state
};

//Exception Codes
enum {
    MB_EX_ILLEGAL_FUNCTION = 0x01, // Function Code not Supported
    MB_EX_ILLEGAL_ADDRESS  = 0x02, // Output Address not exists
    MB_EX_ILLEGAL_VALUE    = 0x03, // Output Value not in Range
    MB_EX_SLAVE_FAILURE    = 0x04, // Slave Device Fails to process request
};

#endif
