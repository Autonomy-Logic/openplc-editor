/*
ModbusSlave.h - Header for Modbus Slave Library
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#ifndef MODBUSSLAVE_H
#define MODBUSSLAVE_H

#include <Arduino.h>
#include "openplc_version.h"
// modbus_types.h pulls modbus_config.h, which brings defines.h and the composite
// build gates (MB_SERIAL_ACTIVE, DEBUG_* defaults). defines.h has no include
// guard, so it is deliberately NOT included directly here — only via that path.
#include "modbus_types.h"
#include "modbus_frame.h"
#include "modbus_crc.h"
#include "modbus_registers.h"
#include "modbus_debug.h"
#include "modbus_pdu.h"
#include "modbus_serial.h"
#include "modbus_tcp.h"

// Shared type/constant declarations (enums, MBinfo, MAX_MB_FRAME, MBAP_SIZE,
// COILS/INPUTSTATUS, bit helpers, MB_DEBUG_* status codes) live in modbus_types.h;
// the build gates above come from modbus_config.h — both included above.

// The TCP platform includes (SPI/Ethernet/WiFi/ETH + ESP32 PHY defines) and the
// TCP server state now live in modbus_tcp.h (included above).

#if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
#include "Controllino.h"
#endif

// scan_counter is declared in arduino_runtime_glue.h with C linkage; the
// .cpp includes that header to bring the declaration into scope, so this
// file deliberately does NOT redeclare it (a second declaration would
// conflict with the C-linkage one and break the build).

// MBinfo, the MB_FC_* / MB_EX_* enums and the MB_DEBUG_* status codes now live
// in modbus_types.h (included above). The shared frame seam (mb_frame,
// mb_frame_len, the `modbus` instance and exceptionResponse) lives in
// modbus_frame.h (included above).

// The serial port/timing globals (mb_serialport/mb_txpin/mb_t15/mb_t35) live in
// modbus_serial.h; the TCP server state (mb_server/mb_serverClients/mb_mbap) and
// mbconfig_ethernet_iface()/handle_tcp() in modbus_tcp.h — both included above.

void mbtask();

// mbconfig_serial_iface() and handle_serial() live in modbus_serial.h;
// process_mbpacket() and the per-FC frame-shape helpers (mb_pdu_request_len,
// mb_pdu_skips_crc) live in modbus_pdu.h; the register store and operation FCs
// (init_mbregs, get/write_discrete, readRegisters..writeMultipleCoils) in
// modbus_registers.h; the debugger FCs (debugInfo..debugGetBoardId) in
// modbus_debug.h; calcCrc() and the CRC tables in modbus_crc.{h,cpp} — all
// included above.

#endif
