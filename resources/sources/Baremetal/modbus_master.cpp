// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_master.h"

#if MB_MASTER_ENABLED

#include <string.h>

#include "arduino_runtime_glue.h"
#include "modbus_master_rtu.h"
#include "modbus_master_tcp.h"
#include "modbus_master_util.h"
#include "modbus_pdu.h"
#include "openplc.h"

namespace {

/** Whether the master saw the PLC running on its previous pass. */
bool g_running = false;

#if MB_MASTER_GROUP_COUNT > 0

/** A poll of the group is in progress: some of its requests are still to go. */
const uint8_t GROUP_ACTIVE = 0x01;
/** The group's staged input values wait for the next commit into the image. */
const uint8_t GROUP_COMMIT = 0x02;
/** The group's output values have been sampled from the image at least once. */
const uint8_t GROUP_SAMPLED = 0x04;

/** Scheduling state of one group: when its next poll starts and how far the current one got. */
struct GroupState
{
    uint32_t due;
    uint32_t done;
    uint8_t flags;
};

GroupState g_groups[MB_MASTER_GROUP_COUNT];

/** Staged value of every point: inputs before their commit, outputs as last sampled. Bits are 0 or 1. */
uint16_t g_values[MB_MASTER_POINT_COUNT];

/** Whether `fc` reads from the device into the image. */
bool is_read(uint8_t fc)
{
    return fc == MB_FC_READ_COILS || fc == MB_FC_READ_INPUT_STAT || fc == MB_FC_READ_REGS ||
           fc == MB_FC_READ_INPUT_REGS;
}

/** The smaller of two counts, as a 16-bit quantity. */
uint16_t smaller(uint32_t a, uint32_t b)
{
    return (uint16_t)(a < b ? a : b);
}

/** Most coils or registers one request of `fc` may cover while both of its frames fit MB_MASTER_PDU_MAX. */
uint16_t max_quantity(uint8_t fc)
{
    switch (fc)
    {
        case MB_FC_READ_COILS:
        case MB_FC_READ_INPUT_STAT:
            return smaller((uint32_t)(MB_MASTER_PDU_MAX - 2) * 8u, 2000u);
        case MB_FC_READ_REGS:
        case MB_FC_READ_INPUT_REGS:
            return smaller((uint32_t)(MB_MASTER_PDU_MAX - 2) / 2u, 125u);
        case MB_FC_WRITE_COILS:
            return smaller((uint32_t)(MB_MASTER_PDU_MAX - 6) * 8u, 1968u);
        case MB_FC_WRITE_REGS:
            return smaller((uint32_t)(MB_MASTER_PDU_MAX - 6) / 2u, 123u);
        case MB_FC_WRITE_COIL:
        case MB_FC_WRITE_REG:
            return 1;
        default:
            return 0;
    }
}

/** Whether group `g` belongs to a device on `link` of `transport`. */
bool on_link(uint16_t g, uint8_t transport, uint16_t link)
{
    const mb_master_device_t &device = MB_MASTER_DEVICES[MB_MASTER_GROUPS[g].device];
    return device.transport == transport && device.link == link;
}

/** Image area of a point's MB_IMG_* code. */
openplc_image_area_t area_of(uint8_t image)
{
    switch (image)
    {
        case MB_IMG_IX:
            return OPENPLC_AREA_BOOL_INPUT;
        case MB_IMG_IW:
            return OPENPLC_AREA_INT_INPUT;
        case MB_IMG_QX:
            return OPENPLC_AREA_BOOL_OUTPUT;
        case MB_IMG_QW:
            return OPENPLC_AREA_INT_OUTPUT;
        default:
            return OPENPLC_AREA_NONE;
    }
}

/** Whether a point's MB_IMG_* code is a bit area. */
bool is_bit_image(uint8_t image)
{
    return image == MB_IMG_IX || image == MB_IMG_QX;
}

/** The image storage behind a point, or NULL when the image has none there. */
void *storage_of(const mb_master_point_t &point)
{
    const openplc_image_area_t area = area_of(point.image);
    if (is_bit_image(point.image))
    {
        const uint32_t bit = (uint32_t)point.index * 8u + point.bit;
        return bit > 0xFFFFu ? NULL : openplc_image_bit(area, (uint16_t)bit);
    }
    uint8_t width = 0;
    void *const slot = openplc_image_slot(area, point.index, &width);
    return width == sizeof(uint16_t) ? slot : NULL;
}

/** Write a staged value into a point's image storage. */
void write_point(const mb_master_point_t &point, uint16_t value)
{
    void *const storage = storage_of(point);
    if (storage == NULL)
        return;
    if (is_bit_image(point.image))
        *(uint8_t *)storage = value != 0 ? 1 : 0;
    else
        memcpy(storage, &value, sizeof(value));
}

/** Read a point's value from the image, 0 where the image has no storage. */
uint16_t read_point(const mb_master_point_t &point)
{
    const void *const storage = storage_of(point);
    if (storage == NULL)
        return 0;
    if (is_bit_image(point.image))
        return *(const uint8_t *)storage != 0 ? 1 : 0;
    uint16_t value = 0;
    memcpy(&value, storage, sizeof(value));
    return value;
}

/** End the group's current poll, if any; its next one starts when it is due. */
void end_poll(uint16_t g)
{
    g_groups[g].flags = (uint8_t)(g_groups[g].flags & ~GROUP_ACTIVE);
    g_groups[g].done = 0;
}

/** Apply a read group's error handling: zero its points, or keep them as they are. */
void apply_error_handling(uint16_t g)
{
    const mb_master_group_t &group = MB_MASTER_GROUPS[g];
    if (!is_read(group.fc) || group.on_error != MB_ERR_ZERO)
        return;
    for (uint32_t j = 0; j < group.length; j++)
        g_values[group.first_point + j] = 0;
    g_groups[g].flags = (uint8_t)(g_groups[g].flags | GROUP_COMMIT);
}

/** Whether `req` is the request the group's poll is waiting on. */
bool is_current(const mb_master_request_t *req)
{
    return req->group < MB_MASTER_GROUP_COUNT && (g_groups[req->group].flags & GROUP_ACTIVE) != 0 &&
           g_groups[req->group].done == req->first;
}

/** Write the PDU of `req` into `pdu` and return its length. */
uint16_t build_pdu(const mb_master_request_t *req, uint8_t *pdu)
{
    const uint16_t *const values = &g_values[MB_MASTER_GROUPS[req->group].first_point + req->first];
    pdu[0] = req->fc;
    put16(&pdu[1], req->address);
    switch (req->fc)
    {
        case MB_FC_WRITE_COIL:
            put16(&pdu[3], values[0] != 0 ? 0xFF00u : 0x0000u);
            return 5;
        case MB_FC_WRITE_REG:
            put16(&pdu[3], values[0]);
            return 5;
        case MB_FC_WRITE_COILS:
        {
            const uint8_t bytes = (uint8_t)((req->quantity + 7u) / 8u);
            put16(&pdu[3], req->quantity);
            pdu[5] = bytes;
            memset(&pdu[6], 0, bytes);
            for (uint16_t j = 0; j < req->quantity; j++)
            {
                if (values[j] != 0)
                    pdu[6 + j / 8] = (uint8_t)(pdu[6 + j / 8] | (1u << (j % 8)));
            }
            return (uint16_t)(6u + bytes);
        }
        case MB_FC_WRITE_REGS:
            put16(&pdu[3], req->quantity);
            pdu[5] = (uint8_t)(2u * req->quantity);
            for (uint16_t j = 0; j < req->quantity; j++)
                put16(&pdu[6 + 2 * j], values[j]);
            return (uint16_t)(6u + 2u * req->quantity);
        default:
            put16(&pdu[3], req->quantity);
            return 5;
    }
}

/** Whether a response PDU answers `req`: its length, function code, byte count or echoed fields. */
bool answers(const mb_master_request_t *req, const uint8_t *pdu, uint16_t len)
{
    if (len < 2 || len != mb_master_response_pdu_len(req) || pdu[0] != req->fc)
        return false;
    switch (req->fc)
    {
        case MB_FC_READ_COILS:
        case MB_FC_READ_INPUT_STAT:
        case MB_FC_READ_REGS:
        case MB_FC_READ_INPUT_REGS:
            return pdu[1] == len - 2;
        case MB_FC_WRITE_COIL:
        case MB_FC_WRITE_REG:
        {
            uint8_t sent[5];
            build_pdu(req, sent);
            return memcmp(pdu, sent, sizeof(sent)) == 0;
        }
        case MB_FC_WRITE_COILS:
        case MB_FC_WRITE_REGS:
            return get16(&pdu[1]) == req->address && get16(&pdu[3]) == req->quantity;
        default:
            return false;
    }
}

/** Restart every group on a RUN edge: all due now, no poll in progress. */
void restart_groups(uint32_t now)
{
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
    {
        end_poll(g);
        g_groups[g].due = now;
    }
}

/** Abandon every poll in progress. */
void stop_groups()
{
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
        end_poll(g);
}

#else

/** Nothing to restart without groups. */
void restart_groups(uint32_t)
{
}

/** Nothing to stop without groups. */
void stop_groups()
{
}

#endif

/** Leave RUN: every poll stops and every connection closes, giving its socket back; where a close may wait,
 *  the TCP connections close one per pass on the passes that follow. */
void stop_master()
{
    stop_groups();
#if MB_MASTER_TCP_ENABLED
    mb_master_tcp_stop();
#endif
#if MB_MASTER_RTU_ENABLED
    mb_master_rtu_stop();
#endif
}

/** Enter RUN with all retry and give-up state cleared. */
void start_master(uint32_t now)
{
    restart_groups(now);
#if MB_MASTER_TCP_ENABLED
    mb_master_tcp_start();
#endif
#if MB_MASTER_RTU_ENABLED
    mb_master_rtu_start();
#endif
}

}

uint16_t mb_master_response_pdu_len(const mb_master_request_t *req)
{
    const int32_t rtu = mb_pdu_response_len(req->fc, req->quantity);
    return rtu > 3 ? (uint16_t)(rtu - 3) : 0;
}

#if MB_MASTER_GROUP_COUNT > 0

void mb_master_commit_inputs(void)
{
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
    {
        if ((g_groups[g].flags & GROUP_COMMIT) == 0)
            continue;
        g_groups[g].flags = (uint8_t)(g_groups[g].flags & ~GROUP_COMMIT);
        const mb_master_group_t &group = MB_MASTER_GROUPS[g];
        for (uint32_t j = 0; j < group.length; j++)
            write_point(MB_MASTER_POINTS[group.first_point + j], g_values[group.first_point + j]);
    }
}

void mb_master_sample_outputs(void)
{
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
    {
        const mb_master_group_t &group = MB_MASTER_GROUPS[g];
        if (is_read(group.fc) || (g_groups[g].flags & GROUP_ACTIVE) != 0)
            continue;
        for (uint32_t j = 0; j < group.length; j++)
            g_values[group.first_point + j] = read_point(MB_MASTER_POINTS[group.first_point + j]);
        g_groups[g].flags = (uint8_t)(g_groups[g].flags | GROUP_SAMPLED);
    }
}

uint16_t mb_master_next_request(uint8_t transport, uint16_t link, uint32_t now, mb_master_request_t *req,
                                uint8_t *pdu)
{
    int32_t chosen = -1;
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
    {
        if (!on_link(g, transport, link))
            continue;
        const GroupState &state = g_groups[g];
        if ((state.flags & GROUP_ACTIVE) != 0)
        {
            chosen = g;
            break;
        }
        if (!is_read(MB_MASTER_GROUPS[g].fc) && (state.flags & GROUP_SAMPLED) == 0)
            continue;
        if (!reached(now, state.due))
            continue;
        if (chosen < 0 || (int32_t)(state.due - g_groups[chosen].due) < 0)
            chosen = g;
    }
    if (chosen < 0)
        return 0;

    const uint16_t g = (uint16_t)chosen;
    const mb_master_group_t &group = MB_MASTER_GROUPS[g];
    GroupState &state = g_groups[g];
    const uint16_t limit = max_quantity(group.fc);
    if ((state.flags & GROUP_ACTIVE) == 0)
    {
        state.due = now + group.cycle_ms;
        if (limit == 0 || group.length == 0)
            return 0;
        state.flags = (uint8_t)(state.flags | GROUP_ACTIVE);
        state.done = 0;
    }

    req->group = g;
    req->first = state.done;
    req->quantity = smaller(group.length - state.done, limit);
    req->address = (uint16_t)(group.offset + state.done);
    req->unit = MB_MASTER_DEVICES[group.device].slave_id;
    req->fc = group.fc;
    return build_pdu(req, pdu);
}

bool mb_master_accept(const mb_master_request_t *req, const uint8_t *pdu, uint16_t len)
{
    if (!is_current(req))
        return false;
    if (!answers(req, pdu, len))
    {
        mb_master_fail(req);
        return false;
    }

    const mb_master_group_t &group = MB_MASTER_GROUPS[req->group];
    uint16_t *const values = &g_values[group.first_point + req->first];
    if (req->fc == MB_FC_READ_COILS || req->fc == MB_FC_READ_INPUT_STAT)
    {
        for (uint16_t j = 0; j < req->quantity; j++)
            values[j] = (uint16_t)((pdu[2 + j / 8] >> (j % 8)) & 1u);
    }
    else if (req->fc == MB_FC_READ_REGS || req->fc == MB_FC_READ_INPUT_REGS)
    {
        for (uint16_t j = 0; j < req->quantity; j++)
            values[j] = get16(&pdu[2 + 2 * j]);
    }

    GroupState &state = g_groups[req->group];
    state.done += req->quantity;
    if (state.done >= group.length)
    {
        end_poll(req->group);
        if (is_read(group.fc))
            state.flags = (uint8_t)(state.flags | GROUP_COMMIT);
    }
    return true;
}

void mb_master_fail(const mb_master_request_t *req)
{
    if (!is_current(req))
        return;
    const uint32_t retry = (uint32_t)millis() + MB_MASTER_GROUPS[req->group].cycle_ms;
    if ((int32_t)(retry - g_groups[req->group].due) > 0)
        g_groups[req->group].due = retry;
    end_poll(req->group);
    apply_error_handling(req->group);
}

void mb_master_link_down(uint8_t transport, uint16_t link)
{
    for (uint16_t g = 0; g < MB_MASTER_GROUP_COUNT; g++)
    {
        if (!on_link(g, transport, link))
            continue;
        end_poll(g);
        apply_error_handling(g);
    }
}

#else

void mb_master_commit_inputs(void)
{
}

void mb_master_sample_outputs(void)
{
}

uint16_t mb_master_next_request(uint8_t, uint16_t, uint32_t, mb_master_request_t *, uint8_t *)
{
    return 0;
}

bool mb_master_accept(const mb_master_request_t *, const uint8_t *, uint16_t)
{
    return false;
}

void mb_master_fail(const mb_master_request_t *)
{
}

void mb_master_link_down(uint8_t, uint16_t)
{
}

#endif

void mb_master_task(void)
{
    if (runtime_get_plc_state() != PLC_STATE_RUNNING)
    {
        if (g_running)
        {
            g_running = false;
            stop_master();
        }
#if MB_MASTER_TCP_ENABLED
        else
        {
            mb_master_tcp_stop();
        }
#endif
        return;
    }
    if (!g_running)
    {
        g_running = true;
        start_master((uint32_t)millis());
    }
#if MB_MASTER_TCP_ENABLED
    mb_master_tcp_service();
#endif
#if MB_MASTER_RTU_ENABLED
    mb_master_rtu_service();
#endif
}

#endif
