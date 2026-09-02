/*
modbus_debug.h - OpenPLC always-on debugger function codes (0x41-0x4B)
Copyright (C) 2022 OpenPLC - Thiago Alves

The debugger PDU handlers, dispatched from process_mbpacket. Kept ungated: the
dispatch in modbus_pdu references them unconditionally (the always-on debugger is
present on every baremetal build). This is the growth home for future custom FCs.
*/

#ifndef MODBUS_DEBUG_H
#define MODBUS_DEBUG_H

#include "modbus_frame.h"

// Phase 4 debugger entrypoints. Signatures changed from MatIEC-era
// (flat u16 index) to the (array_idx: u8, elem_idx: u16) addressing model.
void debugInfo(void);
void debugSetTrace(uint8_t arr, uint16_t elem, uint8_t flag,
                   uint16_t len, void *value);
void debugGetTrace(uint8_t arr, uint16_t startidx, uint16_t endidx);
void debugGetTraceList(uint16_t numIndexes, uint8_t *indexArray);
void debugGetMd5(void *endianness);
// Always-on debugger extras — served even without full Modbus (DEBUGGER_ENABLED).
void debugGetStatus(void);
void debugGetVersion(void);
void debugGetBoardId(void);
// On-device license storage (0x49/0x4A). `len` is the BIG-ENDIAN wire length
// (already unpacked by the dispatcher); the blob CONTENT is little-endian.
void debugWriteLicense(uint16_t len, const uint8_t *blob);  // 0x49
void debugReadLicense(void);                                // 0x4A
// FC 0x4B -- set the runtime run/stop state. Command only; the state is read
// back through debugGetStatus (FC 0x46), which reports it.
void plcSetState(uint8_t desired);

#endif
