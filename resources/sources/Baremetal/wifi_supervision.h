// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#ifndef WIFI_SUPERVISION_H
#define WIFI_SUPERVISION_H

#include <stdint.h>

#include "modbus_master_util.h"

/** Quiet time after which a disconnected, idle station is asked to reconnect, in ms. */
#define WIFI_RECONNECT_QUIET_MS 60000u

/** Whether to ask the driver to reconnect: the station has no address, is not associated or associating,
 *  and nothing happened on it (station event or earlier request) since `quiet_since_ms` for the quiet time. */
static inline bool wifi_reconnect_due(bool has_address, bool joining, uint32_t now_ms, uint32_t quiet_since_ms)
{
    if (has_address || joining)
        return false;
    return reached(now_ms, quiet_since_ms + WIFI_RECONNECT_QUIET_MS);
}

#endif
