/*
license_store.h - Single storage interface for the on-device license blob
Copyright (C) 2022 OpenPLC - Thiago Alves

The one point of contact for persisting the license blob. The closed license-core
CONSUMES this interface; the open-source firmware IMPLEMENTS it (per-arch backend,
each self-gated on its ARDUINO_ARCH_* macro: ESP32 NVS / ESP8266 emulated-EEPROM /
AVR EEPROM).

license_store_read validates magic + crc32 internally, so it returns semantic
status (EMPTY / CORRUPT). ECDSA verify lives ABOVE this layer (out of scope here).
*/

#ifndef LICENSE_STORE_H
#define LICENSE_STORE_H

#include <stddef.h>
#include <stdint.h>

#include "license_blob.h"
#include "modbus_types.h"   // MB_DEBUG_* status codes for lic_status_to_mb()

typedef enum {
    LIC_STORE_OK        = 0,  // operation done; for read: valid blob (magic+crc match)
    LIC_STORE_EMPTY     = 1,  // virgin storage: magic absent OR key/region never written
    LIC_STORE_CORRUPT   = 2,  // magic present but crc32 mismatch
    LIC_STORE_IO_ERROR  = 3,  // backend failure (NVS begin/commit; EEPROM unavailable)
    LIC_STORE_TOO_LARGE = 4,  // len > backend capacity (write) or > caller buffer (read)
    LIC_STORE_UNSUPPORTED = 5,// no backend on this board (weak default): licensing FCs degrade gracefully
} lic_store_status_t;

// Write `len` raw bytes. Validates len <= capacity (else TOO_LARGE).
// Does NOT validate magic/crc/signature (integrity is checked on read / at verify).
lic_store_status_t license_store_write(const uint8_t *blob, size_t len);

// Read the blob into `out` (capacity `cap`). Writes the read size into *out_len.
// EMPTY if virgin, CORRUPT if magic ok but crc fails, TOO_LARGE if cap < stored size.
lic_store_status_t license_store_read(uint8_t *out, size_t cap, size_t *out_len);

// Erase the license (NVS remove / EEPROM zero the length). Idempotent.
lic_store_status_t license_store_erase(void);

// Map a storage status to the Modbus debug status byte returned on the wire.
//   OK        -> MB_DEBUG_SUCCESS             (0x7E)
//   TOO_LARGE -> MB_DEBUG_ERROR_OUT_OF_BOUNDS (0x81, reused)
//   IO_ERROR  -> MB_DEBUG_ERROR_OUT_OF_MEMORY (0x82, reused)
//   EMPTY       -> MB_DEBUG_LIC_EMPTY           (0x83)
//   CORRUPT     -> MB_DEBUG_LIC_CORRUPT         (0x84)
//   UNSUPPORTED -> MB_DEBUG_LIC_UNSUPPORTED     (0x85)
static inline uint8_t lic_status_to_mb(lic_store_status_t st)
{
    switch (st)
    {
        case LIC_STORE_OK:          return MB_DEBUG_SUCCESS;
        case LIC_STORE_TOO_LARGE:   return MB_DEBUG_ERROR_OUT_OF_BOUNDS;
        case LIC_STORE_IO_ERROR:    return MB_DEBUG_ERROR_OUT_OF_MEMORY;
        case LIC_STORE_EMPTY:       return MB_DEBUG_LIC_EMPTY;
        case LIC_STORE_CORRUPT:     return MB_DEBUG_LIC_CORRUPT;
        case LIC_STORE_UNSUPPORTED: return MB_DEBUG_LIC_UNSUPPORTED;
        default:                    return MB_DEBUG_ERROR_OUT_OF_MEMORY;
    }
}

#endif
