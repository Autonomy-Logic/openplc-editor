/*
ModbusSlave.cpp - Source for Modbus Slave Library
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "ModbusSlave.h"
// The debugger handlers (and their arduino_runtime_glue.h / ArduinoUniqueID
// dependencies) moved to modbus_debug.cpp.

// Global Modbus vars — modbus / mb_frame / mb_frame_len moved to modbus_frame.cpp;
// the serial port/timing globals to modbus_serial.cpp; the TCP server state
// (mb_server / mb_serverClients / mb_mbap) to modbus_tcp.cpp.
// init_mbregs / get_discrete / write_discrete moved to modbus_registers.cpp.
// mbconfig_serial_iface() and the serial transport moved to modbus_serial.cpp.
// mbconfig_ethernet_iface() and handle_tcp() moved to modbus_tcp.cpp.


void mbtask()
{
    #ifdef MBTCP
        handle_tcp();
    #endif
    #ifdef MB_SERIAL_ACTIVE
        handle_serial();
    #endif
}


// Serial transport (mbconfig_serial_iface, handle_serial/handle_serial_port,
// mb_rtu_drop_front, RX-assembly buffers, RS485 timing) moved to modbus_serial.cpp.


// process_mbpacket() + mb_pdu_request_len() + mb_pdu_skips_crc() moved to modbus_pdu.cpp.


// Register store + operation FCs (readRegisters..writeMultipleCoils) moved to modbus_registers.cpp.

// Debugger FCs (debugInfo/debugSetTrace/debugGetTrace/debugGetTraceList/debugGetMd5/
// debugGetStatus/debugGetVersion/debugGetBoardId) moved to modbus_debug.cpp.

// calcCrc() and the CRC lookup tables moved to modbus_crc.cpp.


