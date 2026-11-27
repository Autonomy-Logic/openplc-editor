// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef MODBUS_MASTER_H
#define MODBUS_MASTER_H

#include "modbus_master_config.h"

#if MB_MASTER_ENABLED

#include <stdint.h>

#include "modbus_types.h"

/** Largest Modbus TCP ADU (MBAP header, unit id and PDU) the master sends or accepts. */
#define MB_MASTER_ADU_MAX MAX_MB_FRAME

/** MBAP header bytes, unit id included. */
#define MB_MASTER_MBAP_LEN 7

/** Largest PDU of one request or response: what the frame leaves, at most the Modbus 253. */
#define MB_MASTER_PDU_MAX ((MB_MASTER_ADU_MAX - MB_MASTER_MBAP_LEN) < 253 ? (MB_MASTER_ADU_MAX - MB_MASTER_MBAP_LEN) : 253)

/** One request in flight: which group, which part of it, and what was asked. */
typedef struct
{
    uint16_t group;
    uint32_t first;
    uint16_t quantity;
    uint16_t address;
    uint8_t unit;
    uint8_t fc;
} mb_master_request_t;

/** Copy the staged values of every finished read poll into the process image.
 *  Call once per scan, before runtime_plc_cycle(). */
void mb_master_commit_inputs(void);

/** Snapshot the outputs of every write group that is not mid-poll.
 *  Call once per scan, after runtime_plc_cycle(). */
void mb_master_sample_outputs(void);

/** Run the master without blocking: follow the PLC run state (idle with every
 *  connection closed while stopped, a fresh start on each RUN edge) and service
 *  every transport. Call from scheduler() and from the slack in loop(). */
void mb_master_task(void);

/** Build the next request due on a transport's link into `pdu` (at least
 *  MB_MASTER_PDU_MAX bytes) and describe it in `req`. Returns the PDU length,
 *  0 when nothing is due. A group larger than one frame is split here. */
uint16_t mb_master_next_request(uint8_t transport, uint16_t link, uint32_t now, mb_master_request_t *req,
                                uint8_t *pdu);

/** PDU length of the normal response to `req`, from mb_pdu_response_len(). */
uint16_t mb_master_response_pdu_len(const mb_master_request_t *req);

/** Check a response PDU against `req` (function code, byte count, echoed fields)
 *  and, only when all of it is valid, stage its values into the group's points.
 *  A mismatch is one failed poll, applied here; returns whether it was accepted. */
bool mb_master_accept(const mb_master_request_t *req, const uint8_t *pdu, uint16_t len);

/** One failed poll of `req`'s group: a read group applies its error handling, and the
 *  group's next poll starts no earlier than one cycle from now. */
void mb_master_fail(const mb_master_request_t *req);

/** A link is not connected: every poll on it restarts and its read groups apply
 *  their error handling. */
void mb_master_link_down(uint8_t transport, uint16_t link);

#endif

#endif
