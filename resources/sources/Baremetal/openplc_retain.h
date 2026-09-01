/*
openplc_retain.h - Retain-variable storage interface (NODE-94)
Copyright (C) 2026 OpenPLC - Thiago Alves

The one point of contact for persisting retained variables. The runtime
MARSHALS; the platform STORES. Nothing here knows what a retained variable is:
it moves an opaque blob, and the runtime is what turns IEC variables into those
bytes and back (strucpp's iec_retain.hpp).

The split is the point. Retention hardware has nothing in common between
targets — battery-backed SRAM, FRAM, an EEPROM with a 100k-cycle budget, an
NVS partition, a file on a data partition — so the runtime does not try to have
an opinion. It hands over the current values once per scan cycle and asks for
them once at start. What that costs, how often it is really committed, and what
wear it implies are decisions only the platform can make.

IDENTICAL, DELIBERATELY, TO THE runtime-v4 SURFACE. The same four function
names, the same status codes, the same contract text describe the plugin hooks
on the Linux daemon. A vendor writing retain support reads one page and writes
the same shape twice, rather than learning two interfaces for one job.

A board with no backend links and behaves exactly as it did before this file
existed: the weak defaults in openplc_retain_weak.cpp answer UNSUPPORTED,
retain silently degrades to NON_RETAIN, and every variable starts at its
declared initial value. A VPP that ships a real backend defines the STRONG
symbols and overrides them at link time — the same mechanism license_store.h
already uses.
*/

#ifndef OPENPLC_RETAIN_H
#define OPENPLC_RETAIN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    // Operation completed. For a read: a blob was returned in `out`.
    OPLC_RETAIN_OK          = 0,
    // Nothing stored — virgin storage, or cleared. A first boot looks like
    // this, and it is not an error: every retained variable simply keeps its
    // declared initial value.
    OPLC_RETAIN_NO_DATA     = 1,
    // No backend on this platform. THE DEFAULT. Retain degrades to
    // NON_RETAIN, which is what the board did before it had this interface.
    OPLC_RETAIN_UNSUPPORTED = 2,
    // The backend failed (flash write error, NVS commit failure, …).
    OPLC_RETAIN_IO_ERROR    = 3,
    // Blob larger than the backend can hold, or larger than the caller's
    // buffer on a read. See openplc_retain_capacity().
    OPLC_RETAIN_TOO_LARGE   = 4,
} openplc_retain_status_t;

/* Bytes this platform can hold for the retain blob; 0 means no backend.
 *
 * Reported so the runtime can log the mismatch ONCE at start ("retained
 * variables need 5104 bytes, this board holds 4096") instead of failing every
 * scan for the rest of the program's life. Cheap and side-effect free — it is
 * called during setup. */
uint16_t openplc_retain_capacity(void);

/* Store `len` bytes.
 *
 * CALLED ONCE PER SCAN CYCLE, unconditionally, in every PLC state. The runtime
 * does not diff, does not rate-limit and does not decide when a value is worth
 * keeping: it delivers the current bytes every cycle and the decision of what
 * to do with them is yours.
 *
 * That means a driver over slow storage MUST NOT write through on every call.
 * Hold the bytes and flush on your own schedule — every ten seconds, on a
 * value change, on a shutdown signal — whatever the medium can sustain. An
 * EEPROM rated for 100k cycles would be consumed in under an hour by a 20 ms
 * scan writing through.
 *
 * MUST RETURN PROMPTLY AND MUST NOT BLOCK. This runs inside the scan cycle, so
 * time spent here is time the PLC is not scanning; a slow implementation shows
 * up as a scan overrun. Same contract as hardwareStateSwitch(). */
openplc_retain_status_t openplc_retain_write(const uint8_t *blob, uint16_t len);

/* Load the stored blob into `out` (capacity `cap`), writing the length to
 * `out_len`.
 *
 * Called once at program start, after the IEC variables are constructed and
 * before the first scan — and again after any program re-initialisation, since
 * that re-runs every declared initialiser and would otherwise turn a STOP into
 * a cold start.
 *
 * Return OPLC_RETAIN_NO_DATA or OPLC_RETAIN_UNSUPPORTED to leave every
 * retained variable at its initial value. The runtime validates what it gets
 * (magic, format, layout hash, crc32) and refuses a blob it cannot trust, so a
 * backend does not need to guard against a torn write on its own — though one
 * that can detect it should say IO_ERROR rather than hand over rubble. */
openplc_retain_status_t openplc_retain_read(uint8_t *out, uint16_t cap, uint16_t *out_len);

/* Discard the stored blob. Idempotent.
 *
 * Called for a cold reset: the editor sends the RETAIN_RESET function code
 * after a program upload, matching CODESYS, where a download clears retained
 * memory. After this a read must answer NO_DATA. */
openplc_retain_status_t openplc_retain_clear(void);

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_RETAIN_H
