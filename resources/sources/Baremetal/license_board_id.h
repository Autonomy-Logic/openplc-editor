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

typedef enum {
    LIC_BOARD_ID_OK = 0,
    LIC_BOARD_ID_UNSUPPORTED = 1, /* no slot on this board (weak default) */
    LIC_BOARD_ID_IO_ERROR = 2,
    LIC_BOARD_ID_TAKEN = 3,       /* the board already has an ID */
    LIC_BOARD_ID_INVALID = 4,     /* wrong length, or one repeated byte */
} lic_board_id_status_t;

/* VPP hook. Copies the stored ID into `out`; returns LIC_BOARD_ID_SIZE, or 0 when none is stored or `cap` is too small. */
size_t license_board_id_read(uint8_t *out, size_t cap);

/* VPP hook. Persists `id` (LIC_BOARD_ID_SIZE bytes); OK or IO_ERROR. Write-once is enforced by the caller. */
lic_board_id_status_t license_board_id_write(const uint8_t *id, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* LICENSE_BOARD_ID_H */
