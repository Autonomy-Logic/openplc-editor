// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/*
license_platform.c - Board anchor from the VPP hooks and the raw ID report. See license_platform.h.
*/
#include "license_config.h"

#if LIC_PLATFORM_ENABLED

#include "license_board_id.h"
#include "license_platform.h"

/* 0 for an ID of one repeated byte (all 00, all FF, blank slot), else 1. */
static int lic_id_acceptable(const uint8_t *id, size_t len)
{
    size_t i;

    for (i = 1u; i < len; i++) {
        if (id[i] != id[0])
            return 1;
    }
    return 0;
}

/* Factory ID first; the generated board ID only when the HAL reports none. */
size_t license_platform_anchor(uint8_t *out, size_t cap, uint8_t *kind)
{
    uint8_t id[LIC_BOARD_ID_SIZE];
    size_t n;
    size_t i;

    if (out == NULL || kind == NULL)
        return 0u;

    n = hardwareUniqueId(out, cap);
    if (n != 0u && n <= cap && lic_id_acceptable(out, n)) {
        *kind = LIC_ID_KIND_HARDWARE;
        return n;
    }

    if (cap < LIC_BOARD_ID_SIZE)
        return 0u;
    if (license_board_id_read(id, sizeof(id)) != LIC_BOARD_ID_SIZE)
        return 0u;
    if (!lic_id_acceptable(id, LIC_BOARD_ID_SIZE))
        return 0u;
    for (i = 0u; i < LIC_BOARD_ID_SIZE; i++)
        out[i] = id[i];
    *kind = LIC_ID_KIND_GENERATED;
    return LIC_BOARD_ID_SIZE;
}

size_t license_id_report(uint8_t *out, size_t cap)
{
    uint8_t kind = 0u;
    size_t n;

    if (out == NULL || cap < LIC_ID_REPORT_MAX)
        return 0u;

    n = license_platform_anchor(&out[LIC_ID_REPORT_HEADER], LIC_ANCHOR_MAX, &kind);
    if (n == 0u) {
        out[0] = 0u;
        return 1u;
    }
    out[0] = 1u;
    out[1] = kind;
    out[2] = (uint8_t)n;
    return LIC_ID_REPORT_HEADER + n;
}

#endif /* LIC_PLATFORM_ENABLED */
