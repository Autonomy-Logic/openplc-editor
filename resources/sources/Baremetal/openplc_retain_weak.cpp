/*
openplc_retain_weak.cpp - Default retain storage (NODE-94)
Copyright (C) 2026 OpenPLC - Thiago Alves

The firmware's built-in retain store, and the fallback when there is none.
Every definition here is WEAK: a VPP or board library that ships its own store
defines the strong symbols, which override these at link time.

The store is switched on by the project's Persistent Storage setting, which
arrives in defines.h as OPLC_RETAIN_STORE_ENABLED and OPLC_RETAIN_FLUSH_MS. It
uses the storage each Arduino core already ships:

  ESP32                         Preferences (NVS, wear-levelled)
  ESP8266, RP2040 (Earle core)  EEPROM emulated in one flash sector, begin()/commit()
  STM32 without data EEPROM     EEPROM emulated in flash, the core's buffered API
                                (one page erase per commit, not one per byte)
  AVR, megaAVR, STM32 L0/L1,    EEPROM, only changed bytes written (on UNO R4 the
  UNO R4 (Renesas)              core's wear-levelled virtual EEPROM in data flash)

(The UNO R4 core's Preferences library talks to the R4 WiFi's ESP32 modem, so
it is neither local nor present on the R4 Minima; EEPROM is.)

Anything else (SAMD, SAM, mbed, Zephyr), or storage off, falls back to
UNSUPPORTED: every retained variable starts at its declared initial value,
which is IEC's NON_RETAIN — exactly what the board did before this existed.

WHEN IT WRITES. Nothing is written while nothing changes. A change after a quiet
spell is saved straight away; changes that follow within OPLC_RETAIN_FLUSH_MS
are held and saved, latest values only, when that period ends. So a setpoint
change is kept at once, and a value that keeps changing costs at most one write
per period — the period bounds the wear on the medium. A clean STOP saves
anything held, through openplc_retain_flush(). On the EEPROM cores the record
sits at the TOP of the EEPROM and never reaches into the license store's region
at the bottom (offset 0, LIC_BLOB_SIZE + 2 bytes, on licensed AVR / ESP8266
boards). On ESP32 the two use separate NVS namespaces.

Same mechanism, and the same reasoning, as license_store_weak.cpp.
*/
#include "openplc_retain.h"
#include "modbus_config.h"   // defines.h, through its one include path

#if defined(OPLC_RETAIN_STORE_ENABLED) && defined(OPLC_RETAIN_BLOB_SIZE)
#  if defined(ARDUINO_ARCH_ESP32)
#    define OPLC_RETAIN_STORE_PREFERENCES
#    include <Preferences.h>
#  elif defined(ARDUINO_ARCH_ESP8266) || (defined(ARDUINO_ARCH_RP2040) && !defined(ARDUINO_ARCH_MBED))
#    define OPLC_RETAIN_STORE_EEPROM_COMMIT
#    include <EEPROM.h>
#  elif defined(ARDUINO_ARCH_STM32) && !defined(DATA_EEPROM_BASE)
#    define OPLC_RETAIN_STORE_STM32_FLASH
#    include <EEPROM.h>
#  elif defined(ARDUINO_ARCH_AVR) || defined(ARDUINO_ARCH_MEGAAVR) || defined(ARDUINO_ARCH_STM32) || \
        defined(ARDUINO_ARCH_RENESAS)
#    define OPLC_RETAIN_STORE_EEPROM_BYTES
#    include <EEPROM.h>
#  endif
#endif

#if defined(OPLC_RETAIN_STORE_PREFERENCES) || defined(OPLC_RETAIN_STORE_EEPROM_COMMIT) || \
    defined(OPLC_RETAIN_STORE_STM32_FLASH) || defined(OPLC_RETAIN_STORE_EEPROM_BYTES)

#include <string.h>
#include "license_blob.h"   // LIC_BLOB_SIZE: the license store's region at the bottom of EEPROM

namespace {

// The bytes handed to the last write(). The runtime packs into one buffer it
// owns and keeps until the next pack, so they are still valid when a held
// change is saved later — no second copy of the blob in RAM.
const uint8_t *s_bytes         = nullptr;
uint16_t       s_len           = 0;
bool           s_pending       = false;   // a change is held, not yet saved
bool           s_saved_once    = false;   // nothing saved since start: the next change goes at once
uint32_t       s_last_save     = 0;

openplc_retain_status_t store_read(uint8_t *out, uint16_t cap, uint16_t *out_len);
openplc_retain_status_t store_write(const uint8_t *bytes, uint16_t len);
bool                    store_differs(const uint8_t *bytes, uint16_t len);

openplc_retain_status_t save_pending()
{
    if (!s_pending || s_bytes == nullptr) return OPLC_RETAIN_OK;
    s_pending    = false;
    s_saved_once = true;
    s_last_save  = millis();
    return store_write(s_bytes, s_len);
}

#if defined(OPLC_RETAIN_STORE_PREFERENCES)

const char *const kNamespace = "oplc_retain";
const char *const kKey       = "blob";

// What NVS holds, to tell a change without reading flash every scan. ESP32 has
// the RAM for it.
uint8_t  s_shadow[OPLC_RETAIN_BLOB_SIZE];
uint16_t s_shadow_len = 0;

openplc_retain_status_t store_read(uint8_t *out, uint16_t cap, uint16_t *out_len)
{
    Preferences prefs;
    // A read-only begin fails when the namespace was never written: a first boot.
    if (!prefs.begin(kNamespace, true)) return OPLC_RETAIN_NO_DATA;
    const size_t n = prefs.getBytesLength(kKey);
    if (n == 0) { prefs.end(); return OPLC_RETAIN_NO_DATA; }
    if (n > cap || n > sizeof(s_shadow)) { prefs.end(); return OPLC_RETAIN_TOO_LARGE; }
    const size_t got = prefs.getBytes(kKey, out, cap);
    prefs.end();
    if (got != n) return OPLC_RETAIN_IO_ERROR;
    *out_len = (uint16_t)n;
    memcpy(s_shadow, out, n);
    s_shadow_len = (uint16_t)n;
    return OPLC_RETAIN_OK;
}

bool store_differs(const uint8_t *bytes, uint16_t len)
{
    return len != s_shadow_len || memcmp(bytes, s_shadow, len) != 0;
}

openplc_retain_status_t store_write(const uint8_t *bytes, uint16_t len)
{
    if (len > sizeof(s_shadow)) return OPLC_RETAIN_TOO_LARGE;
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return OPLC_RETAIN_IO_ERROR;
    const size_t put = prefs.putBytes(kKey, bytes, len);
    prefs.end();
    if (put != len) return OPLC_RETAIN_IO_ERROR;
    memcpy(s_shadow, bytes, len);
    s_shadow_len = len;
    return OPLC_RETAIN_OK;
}

#else  // the three EEPROM stores share one record layout

// [magic 4][length 2, little-endian][blob], at the top of the EEPROM.
const uint8_t  kMagic[4] = {'O', 'R', 'T', '1'};
const uint16_t kHeader   = 6;
const uint16_t kRecord   = kHeader + OPLC_RETAIN_BLOB_SIZE;

// The bottom of the EEPROM is the license store's on licensed AVR and ESP8266
// boards: a 2-byte length and the blob from offset 0. A retain record that would
// reach into it is refused (TOO_LARGE) rather than written over a license.
const uint16_t kReservedLow = LIC_BLOB_SIZE + 2;
bool record_fits(uint16_t eeprom_len) { return eeprom_len >= kReservedLow && eeprom_len - kReservedLow >= kRecord; }

#if defined(OPLC_RETAIN_STORE_EEPROM_COMMIT)
// One emulated sector, held in RAM by the core. begin() re-reads it, so a
// library that began the EEPROM with a smaller size never truncates this record.
const uint16_t kEepromSize = 4096;
uint16_t eeprom_length()                   { return kEepromSize; }
void     eeprom_open()                     { EEPROM.begin(kEepromSize); }
uint8_t  eeprom_get(uint16_t a)            { return EEPROM.read(a); }      // from RAM
void     eeprom_put(uint16_t a, uint8_t v) { EEPROM.write(a, v); }         // dirty only on a change
bool     eeprom_close()                    { return EEPROM.commit(); }     // no-op when nothing changed
#elif defined(OPLC_RETAIN_STORE_STM32_FLASH)
// The core's buffered API: a RAM copy of the page, changed in place, and
// erased/programmed once. EEPROM.write() would erase the page for every byte.
bool s_dirty = false;
uint16_t eeprom_length()        { return (uint16_t)(E2END + 1); }
void     eeprom_open()          { eeprom_buffer_fill(); s_dirty = false; }
uint8_t  eeprom_get(uint16_t a) { return eeprom_buffered_read_byte(a); }   // from RAM
void     eeprom_put(uint16_t a, uint8_t v)
{
    if (eeprom_buffered_read_byte(a) != v) { eeprom_buffered_write_byte(a, v); s_dirty = true; }
}
bool     eeprom_close()         { if (s_dirty) eeprom_buffer_flush(); s_dirty = false; return true; }
#else  // OPLC_RETAIN_STORE_EEPROM_BYTES
uint16_t eeprom_length()                   { return (uint16_t)EEPROM.length(); }
void     eeprom_open()                     {}
uint8_t  eeprom_get(uint16_t a)            { return EEPROM.read(a); }
void     eeprom_put(uint16_t a, uint8_t v) { EEPROM.update(a, v); }        // writes only a changed byte
bool     eeprom_close()                    { return true; }
#endif

uint16_t record_base() { return eeprom_length() - kRecord; }

openplc_retain_status_t store_read(uint8_t *out, uint16_t cap, uint16_t *out_len)
{
    if (!record_fits(eeprom_length())) return OPLC_RETAIN_TOO_LARGE;
    eeprom_open();
    const uint16_t base = record_base();
    for (uint16_t i = 0; i < 4; ++i) {
        if (eeprom_get(base + i) != kMagic[i]) return OPLC_RETAIN_NO_DATA;
    }
    const uint16_t len = (uint16_t)(eeprom_get(base + 4) | (eeprom_get(base + 5) << 8));
    if (len == 0) return OPLC_RETAIN_NO_DATA;
    if (len > cap || len > OPLC_RETAIN_BLOB_SIZE) return OPLC_RETAIN_TOO_LARGE;
    for (uint16_t i = 0; i < len; ++i) out[i] = eeprom_get(base + kHeader + i);
    *out_len = len;
    return OPLC_RETAIN_OK;
}

// Compared with what the EEPROM (or the core's RAM copy of it) already holds.
bool store_differs(const uint8_t *bytes, uint16_t len)
{
    if (!record_fits(eeprom_length())) return false;   // cannot be stored at all
    const uint16_t base = record_base();
    for (uint16_t i = 0; i < 4; ++i) {
        if (eeprom_get(base + i) != kMagic[i]) return true;
    }
    if (eeprom_get(base + 4) != (uint8_t)(len & 0xFF) || eeprom_get(base + 5) != (uint8_t)(len >> 8)) return true;
    for (uint16_t i = 0; i < len; ++i) {
        if (eeprom_get(base + kHeader + i) != bytes[i]) return true;
    }
    return false;
}

openplc_retain_status_t store_write(const uint8_t *bytes, uint16_t len)
{
    if (len > OPLC_RETAIN_BLOB_SIZE || !record_fits(eeprom_length())) return OPLC_RETAIN_TOO_LARGE;
    eeprom_open();
    const uint16_t base = record_base();
    for (uint16_t i = 0; i < 4; ++i) eeprom_put(base + i, kMagic[i]);
    eeprom_put(base + 4, (uint8_t)(len & 0xFF));
    eeprom_put(base + 5, (uint8_t)(len >> 8));
    for (uint16_t i = 0; i < len; ++i) eeprom_put(base + kHeader + i, bytes[i]);
    return eeprom_close() ? OPLC_RETAIN_OK : OPLC_RETAIN_IO_ERROR;
}

#endif

}  // namespace

// The stored values are offered back whatever program wrote them: the runtime
// checks the blob's layout hash and refuses one that no longer fits, so a body
// edit keeps retained values and a changed declaration does not (IEC 61131-3
// §6.5.6.1, warm restart). The identity is therefore not compared here.
__attribute__((weak)) openplc_retain_status_t openplc_retain_read(const char *, uint16_t,
                                                                 uint8_t *out, uint16_t cap,
                                                                 uint16_t *out_len)
{
    if (out_len) *out_len = 0;
    if (out == nullptr || out_len == nullptr) return OPLC_RETAIN_NO_DATA;
    return store_read(out, cap, out_len);
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_write(const uint8_t *bytes, uint16_t len)
{
    s_bytes = bytes;
    s_len   = len;
    // Look for a change only while none is held: once one is, the latest
    // values are saved when the period ends, whatever happens in between.
    if (!s_pending) {
        if (!store_differs(bytes, len)) return OPLC_RETAIN_OK;
        s_pending = true;
    }
    // After a quiet period (or the first change since start) save at once;
    // otherwise hold until the period since the last save has run out.
    if (!s_saved_once || (uint32_t)(millis() - s_last_save) >= (uint32_t)OPLC_RETAIN_FLUSH_MS) {
        return save_pending();
    }
    return OPLC_RETAIN_OK;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_flush(void)
{
    return save_pending();
}

#else  // no built-in store on this board, or Persistent Storage is off

__attribute__((weak)) openplc_retain_status_t openplc_retain_read(const char *, uint16_t,
                                                                 uint8_t *, uint16_t,
                                                                 uint16_t *out_len)
{
    // Zero the length even on the unsupported path: a caller that ignores the
    // status and reads `out_len` would otherwise act on an uninitialised
    // count, which is the kind of thing that surfaces once, in the field, as
    // a restore from bytes nobody wrote.
    if (out_len) *out_len = 0;
    return OPLC_RETAIN_UNSUPPORTED;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_write(const uint8_t *, uint16_t)
{
    return OPLC_RETAIN_UNSUPPORTED;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_flush(void)
{
    // OK rather than UNSUPPORTED: "commit anything you are holding" is
    // satisfied by a backend that holds nothing. The runtime does not act on
    // the result, and reporting failure here would put a misleading line in
    // the log of every board without retention, on every stop.
    return OPLC_RETAIN_OK;
}

#endif
