// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/*
license_platform.h - Board anchor from the VPP hooks and the raw ID report (FC 0x48).
*/
#ifndef LICENSE_PLATFORM_H
#define LICENSE_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

#include "license_board_id.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Longest anchor the report carries. */
#define LIC_ANCHOR_MAX 64u

/* Factory ID from hardwareUniqueId(). */
#define LIC_ID_KIND_HARDWARE 1u
/* ID the editor wrote into the board-ID slot. */
#define LIC_ID_KIND_GENERATED 2u

/* [count] + one [kind][len] header. */
#define LIC_ID_REPORT_HEADER 3u
#define LIC_ID_REPORT_MAX (LIC_ID_REPORT_HEADER + LIC_ANCHOR_MAX)

/** VPP HAL hook (openplc.h); the weak default in license_board_id_weak.cpp reports no ID. */
size_t hardwareUniqueId(uint8_t *out, size_t cap);

/**
 * Read this board's anchor into out and its LIC_ID_KIND_* into *kind: the
 * factory ID, else the generated board ID. Returns its length, or 0 when the
 * board has neither; callers must treat 0 as a refusal.
 */
size_t license_board_anchor(uint8_t *out, size_t cap, uint8_t *kind);

/**
 * Write the raw ID report into out: [count:u8], then [kind:u8][len:u8][bytes]
 * per source. A board with no ID writes count 0. Returns the bytes written, or 0
 * when cap is below LIC_ID_REPORT_MAX.
 */
size_t license_id_report(uint8_t *out, size_t cap);

/**
 * Store a generated board ID once (FC 0x4E). Refused with TAKEN when the board
 * already reports a factory ID or holds a generated one, and with INVALID when
 * id is not LIC_BOARD_ID_SIZE bytes or is one repeated byte. The write is read
 * back before OK is returned.
 */
lic_board_id_status_t license_board_id_provision(const uint8_t *id, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* LICENSE_PLATFORM_H */
