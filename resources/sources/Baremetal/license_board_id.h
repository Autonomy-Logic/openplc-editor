// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/*
license_board_id.h - Write-once slot for the 16-byte generated board ID, used as
the anchor on boards whose silicon has no usable unique ID.
*/

#ifndef LICENSE_BOARD_ID_H
#define LICENSE_BOARD_ID_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LIC_BOARD_ID_SIZE 16u

/* Copies the stored ID into `out`; returns LIC_BOARD_ID_SIZE, or 0 when none is stored or `cap` is too small. */
size_t license_board_id_read(uint8_t *out, size_t cap);

/* Stores `id` (LIC_BOARD_ID_SIZE bytes) when the slot is empty; returns 1 on success, 0 otherwise. */
int license_board_id_write(const uint8_t *id, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* LICENSE_BOARD_ID_H */
