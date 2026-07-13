/*
license_store_esp8266.cpp - ESP8266 emulated-EEPROM backend for the license store
Copyright (C) 2022 OpenPLC - Thiago Alves

The ESP8266 has NO real EEPROM and NO NVS/Preferences (that is ESP32-only). Its
Arduino core emulates EEPROM over a single reserved flash sector, mirrored in RAM:
`EEPROM.begin(size)` loads the sector into RAM, reads/writes hit RAM, and
`EEPROM.commit()` flushes RAM back to flash. So the two differences vs. the AVR
backend are: (1) begin(size) is mandatory before any access, and (2) writes are
NOT persisted until commit().

Layout (same as AVR):
  addr 0: uint16_t blobLen (LE)
  addr 2: `blobLen` bytes of blob
Reserved region = LIC_BLOB_SIZE + 2 (bump if the blob format grows).
No malloc — the caller supplies the buffer (Modbus handler uses mb_frame).
*/

#if defined(ARDUINO_ARCH_ESP8266)

#include <Arduino.h>
#include <EEPROM.h>

#include "license_store.h"

#define LIC_EEPROM_LEN_ADDR   0   // uint16_t blobLen
#define LIC_EEPROM_BLOB_ADDR  2   // blob starts here
#define LIC_EEPROM_SIZE       (LIC_BLOB_SIZE + 2)   // len word + blob

lic_store_status_t license_store_write(const uint8_t *blob, size_t len)
{
    // len lives in a uint16_t on the wire/EEPROM; +2 for the stored length word.
    if (len + 2 > (size_t)LIC_EEPROM_SIZE)
        return LIC_STORE_TOO_LARGE;

    EEPROM.begin(LIC_EEPROM_SIZE);

    uint16_t blobLen = (uint16_t)len;
    EEPROM.put(LIC_EEPROM_LEN_ADDR, blobLen);   // LE u16 (RAM mirror)
    for (uint16_t i = 0; i < blobLen; i++)
        EEPROM.write(LIC_EEPROM_BLOB_ADDR + i, blob[i]);   // RAM mirror

    bool ok = EEPROM.commit();   // flush RAM -> flash
    EEPROM.end();
    return ok ? LIC_STORE_OK : LIC_STORE_IO_ERROR;
}

lic_store_status_t license_store_read(uint8_t *out, size_t cap, size_t *out_len)
{
    EEPROM.begin(LIC_EEPROM_SIZE);

    uint16_t blobLen = 0;
    EEPROM.get(LIC_EEPROM_LEN_ADDR, blobLen);   // LE u16

    // Virgin flash reads 0xFF -> length word is 0xFFFF; explicitly zero -> empty.
    if (blobLen == 0 || blobLen == 0xFFFF)
    {
        EEPROM.end();
        return LIC_STORE_EMPTY;
    }
    if (blobLen > cap)
    {
        EEPROM.end();
        return LIC_STORE_TOO_LARGE;
    }

    for (uint16_t i = 0; i < blobLen; i++)
        out[i] = EEPROM.read(LIC_EEPROM_BLOB_ADDR + i);
    EEPROM.end();
    if (out_len) *out_len = blobLen;

    // A truncated blob can never carry a valid magic+crc -> CORRUPT.
    if (blobLen < LIC_BLOB_SIZE)
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
    // Clear the length word so read() returns EMPTY (0 is the explicit-empty
    // sentinel). Cheaper than zeroing the whole region.
    EEPROM.begin(LIC_EEPROM_SIZE);
    uint16_t zero = 0;
    EEPROM.put(LIC_EEPROM_LEN_ADDR, zero);
    bool ok = EEPROM.commit();
    EEPROM.end();
    return ok ? LIC_STORE_OK : LIC_STORE_IO_ERROR;
}

#endif // ARDUINO_ARCH_ESP8266
