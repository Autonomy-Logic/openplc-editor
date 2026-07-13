/*
license_store_avr.cpp - AVR EEPROM backend for the license store (OLS-06)
Copyright (C) 2022 OpenPLC - Thiago Alves

EEPROM layout from offset 0 (reserved region):
  addr 0: uint16_t blobLen (LE — native AVR)
  addr 2: `blobLen` bytes of blob
Capacity = EEPROM.length() (UNO/328P = 1024, MEGA/2560 = 4096); usable = length()-2.
No malloc — the caller supplies the buffer (Modbus handler uses mb_frame).
*/

#if defined(ARDUINO_ARCH_AVR)

#include <Arduino.h>
#include <EEPROM.h>

#include "license_store.h"

#define LIC_EEPROM_LEN_ADDR   0   // uint16_t blobLen
#define LIC_EEPROM_BLOB_ADDR  2   // blob starts here

lic_store_status_t license_store_write(const uint8_t *blob, size_t len)
{
    // len lives in a uint16_t on the wire/EEPROM; +2 for the stored length word.
    if (len + 2 > (size_t)EEPROM.length())
        return LIC_STORE_TOO_LARGE;

    uint16_t blobLen = (uint16_t)len;
    EEPROM.put(LIC_EEPROM_LEN_ADDR, blobLen);   // native LE u16
    for (uint16_t i = 0; i < blobLen; i++)
        EEPROM.update(LIC_EEPROM_BLOB_ADDR + i, blob[i]);  // update() spares wear
    return LIC_STORE_OK;
}

lic_store_status_t license_store_read(uint8_t *out, size_t cap, size_t *out_len)
{
    uint16_t blobLen = 0;
    EEPROM.get(LIC_EEPROM_LEN_ADDR, blobLen);   // native LE u16

    // Virgin EEPROM reads 0xFF -> length word is 0xFFFF; explicitly zero -> empty.
    if (blobLen == 0 || blobLen == 0xFFFF)
        return LIC_STORE_EMPTY;
    if (blobLen > cap)
        return LIC_STORE_TOO_LARGE;

    for (uint16_t i = 0; i < blobLen; i++)
        out[i] = EEPROM.read(LIC_EEPROM_BLOB_ADDR + i);
    if (out_len) *out_len = blobLen;

    // Validate magic (first 4 bytes = 4F 50 4C 43). Absent -> treat as EMPTY.
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
    // Cheaper than zeroing the whole region: clear the length word so read()
    // returns EMPTY. (0 is the explicit-empty sentinel.)
    uint16_t zero = 0;
    EEPROM.put(LIC_EEPROM_LEN_ADDR, zero);
    return LIC_STORE_OK;
}

#endif // ARDUINO_ARCH_AVR
