// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/*
license_board_id_weak.cpp - Defaults for a HAL with no factory ID and no generated-ID slot, and
for builds without the board-ID layer (ID report with count 0, no provisioning). A VPP HAL overrides them.
*/
#include "license_board_id.h"
#include "license_platform.h"

__attribute__((weak)) size_t hardwareUniqueId(uint8_t *out, size_t cap)
{
    (void)out;
    (void)cap;
    return 0u;
}

__attribute__((weak)) size_t license_board_id_read(uint8_t *out, size_t cap)
{
    (void)out;
    (void)cap;
    return 0u;
}

__attribute__((weak)) lic_board_id_status_t license_board_id_write(const uint8_t *id, size_t len)
{
    (void)id;
    (void)len;
    return LIC_BOARD_ID_UNSUPPORTED;
}

__attribute__((weak)) size_t license_id_report(uint8_t *out, size_t cap)
{
    if (out == NULL || cap < 1u)
        return 0u;
    out[0] = 0u;
    return 1u;
}

__attribute__((weak)) lic_board_id_status_t license_board_id_provision(const uint8_t *id, size_t len)
{
    (void)id;
    (void)len;
    return LIC_BOARD_ID_UNSUPPORTED;
}
