/*
license_store_esp32.cpp - ESP32 NVS backend for the license store (OLS-05)
Copyright (C) 2022 OpenPLC - Thiago Alves

Uses the Arduino Preferences API over the default NVS partition (no custom
partitions.csv). Namespace "oplc-lic", key "blob" (both <= 15 chars, NVS limit).
*/

#if defined(ARDUINO_ARCH_ESP32)

#include <Arduino.h>
#include <Preferences.h>

#include "license_store.h"

#define LIC_NVS_NAMESPACE  "oplc-lic"
#define LIC_NVS_KEY        "blob"

lic_store_status_t license_store_write(const uint8_t *blob, size_t len)
{
    Preferences prefs;
    if (!prefs.begin(LIC_NVS_NAMESPACE, false))   // read/write
        return LIC_STORE_IO_ERROR;

    size_t written = prefs.putBytes(LIC_NVS_KEY, blob, len);
    prefs.end();

    // putBytes returns bytes stored; anything short of `len` is an I/O failure
    // (e.g. NVS partition full). TOO_LARGE surfaces here too, as IO_ERROR — NVS
    // has no fixed small cap like EEPROM, so a short write is the only signal.
    if (written != len)
        return LIC_STORE_IO_ERROR;
    return LIC_STORE_OK;
}

lic_store_status_t license_store_read(uint8_t *out, size_t cap, size_t *out_len)
{
    Preferences prefs;
    if (!prefs.begin(LIC_NVS_NAMESPACE, true))    // read-only
        return LIC_STORE_IO_ERROR;

    size_t n = prefs.getBytesLength(LIC_NVS_KEY);
    if (n == 0) {                                 // key absent -> virgin
        prefs.end();
        return LIC_STORE_EMPTY;
    }
    if (n > cap) {
        prefs.end();
        return LIC_STORE_TOO_LARGE;
    }

    size_t got = prefs.getBytes(LIC_NVS_KEY, out, n);
    prefs.end();
    if (got != n)
        return LIC_STORE_IO_ERROR;
    if (out_len) *out_len = n;

    // Validate magic (first 4 bytes = 4F 50 4C 43). Absent -> EMPTY.
    if (n < LIC_BLOB_SIZE)
        return LIC_STORE_CORRUPT;
    const lic_blob_t *b = (const lic_blob_t *)out;
    if (b->payload.magic != LIC_MAGIC_LE)
        return LIC_STORE_EMPTY;

    // crc32 covers [payload||signature] (offsets 0..101), not itself.
    uint32_t computed = crc32_iso_hdlc(out, LIC_BLOB_SIZE - sizeof(uint32_t));
    if (computed != b->crc32)
        return LIC_STORE_CORRUPT;

    return LIC_STORE_OK;
}

lic_store_status_t license_store_erase(void)
{
    Preferences prefs;
    if (!prefs.begin(LIC_NVS_NAMESPACE, false))
        return LIC_STORE_IO_ERROR;
    prefs.remove(LIC_NVS_KEY);
    prefs.end();
    return LIC_STORE_OK;   // idempotent — removing an absent key is fine
}

#endif // ARDUINO_ARCH_ESP32
