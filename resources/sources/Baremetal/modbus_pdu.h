/*
modbus_pdu.h - Transport-agnostic Modbus PDU dispatch + per-FC frame shape
Copyright (C) 2022 OpenPLC - Thiago Alves

The protocol layer: it owns the set of function codes and their shapes. A
transport fills mb_frame with a request, calls process_mbpacket() to dispatch it
(operation FC -> modbus_registers, debug FC -> modbus_debug) and read the
response back out. The transport does NOT know the FC set — it asks this layer
via mb_pdu_request_len() / mb_pdu_skips_crc(), so adding a function code touches
only this file plus its handler, never the transports.
*/

#ifndef MODBUS_PDU_H
#define MODBUS_PDU_H

#include "modbus_frame.h"

// Dispatch the PDU in mb_frame[0..mb_frame_len) to its handler and build the
// response back into mb_frame.
void process_mbpacket();

// Total on-wire length (slave id + PDU + 2 CRC bytes) of the RTU request whose
// first `n` bytes are in `f`: >0 for a known length, 0 when more header bytes are
// needed to size it, -1 for a function code we do not serve (so the byte cannot
// be a frame head). Length is implicit in Modbus RTU — derived per FC, exactly as
// process_mbpacket() later parses the fields.
int32_t mb_pdu_request_len(const uint8_t *f, uint16_t n);

// True for the private debugger FCs, whose RTU frames deliberately skip CRC
// validation (they are well-formed and performance-sensitive). Lets the serial
// transport decide CRC handling without hardcoding the debug FC list.
bool mb_pdu_skips_crc(uint8_t fc);

#endif
