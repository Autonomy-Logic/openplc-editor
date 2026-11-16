// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_PDU_H
#define MODBUS_PDU_H

#include "modbus_frame.h"

// Dispatch the PDU in mb_frame[0..mb_frame_len) to its handler and build the
// response back into mb_frame.
void process_mbpacket();

// Total on-wire length (slave id + PDU + 2 CRC bytes) of the RTU request whose first `n` bytes are in `f`: >0 for a
// known length, 0 when more header bytes are needed to size it, -1 for a function code that is not served.
int32_t mb_pdu_request_len(const uint8_t *f, uint16_t n);

/** Total on-wire length (slave id + PDU + 2 CRC bytes) of the normal response to an
 *  operation request of function code `fc` covering `quantity` coils or registers, the
 *  inverse of mb_pdu_request_len(); -1 for another function code or a quantity it does not allow. */
int32_t mb_pdu_response_len(uint8_t fc, uint16_t quantity);

// True for the private debugger FCs, whose RTU frames skip CRC validation.
bool mb_pdu_skips_crc(uint8_t fc);

// True for the editor's private function codes, 0x41-0x4B.
bool mb_pdu_is_editor_fc(uint8_t fc);

#endif
