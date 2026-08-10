/*
license_blob.h - On-device license blob binary layout + storage CRC
Copyright (C) 2022 OpenPLC - Thiago Alves

The C side of the license blob contract. Cross-pinned to the TypeScript
serializer (src/backend/shared/debug/license-blob.ts) by the golden vector in
its __tests__/fixtures/license-golden.json -- a layout change on either side
must fail a test rather than produce a blob the other end silently rejects.
Shared by every storage backend (AVR EEPROM, ESP32 NVS) and by the Modbus
license handlers. Layout is PACKED and LITTLE-ENDIAN for every multi-byte field
of the struct (magic, crc32). This is INDEPENDENT of the Modbus wire, which
carries the transfer `len` in BIG-ENDIAN (see modbus_pdu.cpp / modbus_debug.cpp).

    ENDIANNESS DUALITY: blob CONTENT is LITTLE-ENDIAN; the Modbus wire
    `len` field is BIG-ENDIAN. Do not confuse the two.
*/

#ifndef LICENSE_BLOB_H
#define LICENSE_BLOB_H

#include <stddef.h>
#include <stdint.h>

// Byte layout (packed, contiguous — no padding):
//  off  field         type          size  notes
//   0   magic         uint32_t LE    4    'OPLC' -> bytes 4F 50 4C 43 (LE u32 = 0x434C504F)
//   4   fmt_version   uint8_t        1
//   5   key_id        uint8_t        1    signing-key id (rotation)
//   6   device_id     uint8_t[16]   16
//  22   product_id    uint8_t[8]     8    vpp id
//  30   (end of signed payload — payload = 30 bytes)
//  30   signature     uint8_t[64]   64    ECDSA P-256 r||s raw (not DER)
//  94   crc32         uint32_t LE    4    over [payload||signature] (offsets 0..93)
//  98   (end of blob — sizeof(lic_blob_t) == 98)

#pragma pack(push, 1)
typedef struct {
    uint32_t magic;          // 'OPLC' -> bytes 4F 50 4C 43 (LE u32 = 0x434C504F)
    uint8_t  fmt_version;
    uint8_t  key_id;         // signing-key id (rotation)
    uint8_t  device_id[16];
    uint8_t  product_id[8];  // vpp id
} lic_payload_t;             // 30 bytes

typedef struct __attribute__((packed)) {
    lic_payload_t payload;   // offsets 0..29
    uint8_t  signature[64];  // offsets 30..93 (ECDSA P-256 r||s raw)
    uint32_t crc32;          // offset 94 (covers [payload||signature], 0..93)
} lic_blob_t;                // 98 bytes
#pragma pack(pop)

// Belt-and-suspenders: both #pragma pack and __attribute__((packed)) so AVR-GCC
// and xtensa-GCC (which treat the two differently) both drop the padding.

#define LIC_MAGIC_LE      0x434C504Fu   /* bytes 4F 50 4C 43 */
#define LIC_BLOB_SIZE     98u
#define LIC_PAYLOAD_SIZE  30u

// Portable compile-time assert. Every Baremetal .cpp includes this header, so it
// is compiled as C++, where static_assert is a keyword. _Static_assert is C-only
// (C11) and the C++ frontend (xtensa/avr gcc) rejects it. Keep the C form for the
// host golden test, which compiles this header as C11.
#if defined(__cplusplus)
    #define LIC_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
    #define LIC_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif

LIC_STATIC_ASSERT(sizeof(lic_payload_t) == 30, "lic_payload_t must be 30 bytes");
LIC_STATIC_ASSERT(sizeof(lic_blob_t)    == 98, "lic_blob_t must be 98 bytes");

// CRC-32/ISO-HDLC (a.k.a. CRC-32, zlib/PKZIP).
//   poly 0xEDB88320 (reflected) · init 0xFFFFFFFF · refin/refout true · xorout 0xFFFFFFFF
//   test vector: crc32_iso_hdlc("123456789", 9) == 0xCBF43926
// Bitwise loop (no 256-entry table) to save flash on AVR — the blob is only 94
// bytes, so the ~8x/byte cost is negligible. Must match the TS implementation
// (license-blob.ts crc32IsoHdlc) byte-for-byte.
static inline uint32_t crc32_iso_hdlc(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++)
    {
        crc ^= (uint32_t)data[i];
        for (uint8_t b = 0; b < 8; b++)
        {
            uint32_t mask = -(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (0xEDB88320u & mask);
        }
    }
    return crc ^ 0xFFFFFFFFu;
}

#endif
