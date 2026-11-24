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

/** How far ahead of `now` an event stamp may be and still count as the newest, in ms: the time a station event
 *  callback can run between the supervision's millis() read and its stamp read. */
#define WIFI_STAMP_AHEAD_MAX_MS 1000u

/** Start of the quiet window at `now_ms`: the newer of `last_event_ms` and `quiet_since_ms`, judged by age at
 *  `now_ms`. A stamp ahead of `now_ms` by at most WIFI_STAMP_AHEAD_MAX_MS is newer than any stamp that is not; any
 *  other stamp is as old as `now_ms - stamp` in unsigned 32-bit ms, so stamps up to 49.7 days old compare right.
 *  Ages are taken from `now_ms + WIFI_STAMP_AHEAD_MAX_MS`, which orders both kinds of stamp in one comparison. */
static inline uint32_t wifi_quiet_start(uint32_t now_ms, uint32_t last_event_ms, uint32_t quiet_since_ms)
{
    const uint32_t horizon_ms = (uint32_t)(now_ms + WIFI_STAMP_AHEAD_MAX_MS);
    const uint32_t event_age_ms = (uint32_t)(horizon_ms - last_event_ms);
    const uint32_t window_age_ms = (uint32_t)(horizon_ms - quiet_since_ms);
    return event_age_ms <= window_age_ms ? last_event_ms : quiet_since_ms;
}

/** One supervision pass: sets `*quiet_since_ms` to wifi_quiet_start(), returns wifi_reconnect_due() on it, and when
 *  that is true restarts the window at `now_ms`. */
static inline bool wifi_supervise_step(bool has_address, bool joining, uint32_t now_ms, uint32_t last_event_ms,
                                       uint32_t *quiet_since_ms)
{
    *quiet_since_ms = wifi_quiet_start(now_ms, last_event_ms, *quiet_since_ms);
    if (!wifi_reconnect_due(has_address, joining, now_ms, *quiet_since_ms))
        return false;
    *quiet_since_ms = now_ms;
    return true;
}

#endif
