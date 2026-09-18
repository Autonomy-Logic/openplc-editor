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

IDENTICAL, DELIBERATELY, TO THE runtime-v4 SURFACE. The same three function
names, the same status codes, the same contract text describe the plugin hooks
on the Linux daemon, and the two runtimes call them at the same points in the
PLC lifecycle. A vendor writing retain support reads one page and writes the
same shape twice, rather than learning two interfaces for one job.

THE THREE CALLS, AND WHEN THEY HAPPEN

    start   openplc_retain_read()    once, before the first scan
    scan    openplc_retain_write()   every cycle, WHILE RUNNING ONLY
    stop    openplc_retain_flush()   once, on the transition into STOP

WRITE IS THE DURABILITY PATH; FLUSH IS ONLY A HINT. This matters enough to say
before anything else, because getting it backwards produces a driver that looks
correct and protects nothing. Retention exists for the power cut nobody
schedules, and a power cut does not call flush(). A driver that commits solely
in flush() therefore loses everything in exactly the case it was written for.
Decide durability in write(); treat flush() as "if you are holding anything,
now is a good moment".

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

/* Length of the program identity handed to openplc_retain_read().
 *
 * An MD5 rendered as lower-case hex: exactly 32 characters, and NOT guaranteed
 * to be NUL-terminated. Compare with memcmp over this length, never strcmp. */
#define OPLC_RETAIN_PROGRAM_ID_LEN 32

typedef enum {
    // Operation completed. For a read: a blob was returned in `out`.
    OPLC_RETAIN_OK          = 0,
    // Nothing stored — virgin storage, or discarded because the program
    // changed. A first boot looks like this, and it is not an error: every
    // retained variable simply keeps its declared initial value.
    OPLC_RETAIN_NO_DATA     = 1,
    // No backend on this platform. THE DEFAULT. Retain degrades to
    // NON_RETAIN, which is what the board did before it had this interface.
    OPLC_RETAIN_UNSUPPORTED = 2,
    // The backend failed (flash write error, NVS commit failure, …).
    OPLC_RETAIN_IO_ERROR    = 3,
    // Blob larger than the backend can hold, or larger than the caller's
    // buffer on a read. Answer this from write() rather than expecting the
    // runtime to ask a capacity question first — only the driver knows what
    // its medium can take, and one that compresses or spills knows it better
    // than any number it could publish up front.
    OPLC_RETAIN_TOO_LARGE   = 4,
} openplc_retain_status_t;

/* Load the stored blob for THIS program into `out` (capacity `cap`), writing
 * the length to `out_len`.
 *
 * Called once at program start, after the IEC variables are constructed and
 * before the first scan — and again on the transition into RUN and after a
 * program re-initialisation, since that re-runs every declared initialiser and
 * would otherwise turn a STOP into a cold start. It must therefore be safe to
 * call more than once; a second call on an unchanged program is expected to
 * hand back the same bytes.
 *
 * `program_md5` is this program's identity, OPLC_RETAIN_PROGRAM_ID_LEN
 * characters, possibly not NUL-terminated (see the macro above).
 *
 * THE DRIVER DECIDES WHETHER THE STORED BYTES STILL BELONG TO THIS PROGRAM.
 * That decision lives here, and not in the runtime, because it is inseparable
 * from how the driver stores things:
 *
 *   - identity matches, or nothing has been stored yet → behave as a plain
 *     read: OK with the blob, or NO_DATA when the store is empty;
 *   - identity differs from what is stored → THE STORED VALUES BELONG TO A
 *     PROGRAM THAT IS NO LONGER RUNNING. Discard them, log one line saying
 *     storage was cleared, and answer NO_DATA. Every retained variable then
 *     starts at its declared initial value, which is what a new program means.
 *
 * DO NOT PERSIST THE NEW IDENTITY HERE. Keep it and commit it alongside the
 * blob on the next openplc_retain_write(), so a read never mutates storage and
 * the identity is only ever written together with the bytes it describes. If
 * the PLC never reaches RUN, nothing is stored and the next boot simply reaches
 * the same conclusion again — idempotent, with nothing lost.
 *
 * Return OPLC_RETAIN_NO_DATA or OPLC_RETAIN_UNSUPPORTED to leave every
 * retained variable at its initial value. The runtime validates what it does
 * get (magic, format, layout hash, crc32) and refuses a blob it cannot trust,
 * so a backend does not need to guard against a torn write on its own — though
 * one that can detect it should say IO_ERROR rather than hand over rubble.
 *
 * UNSUPPORTED HERE SWITCHES RETENTION OFF FOR THE RUN. The runtime stops
 * marshalling after it, so a board with no backend does not pay to pack a blob
 * every cycle that nothing will store. */
openplc_retain_status_t openplc_retain_read(const char *program_md5, uint16_t md5_len,
                                            uint8_t *out, uint16_t cap, uint16_t *out_len);

/* Store `len` bytes.
 *
 * CALLED ONCE PER SCAN CYCLE, unconditionally, while the PLC is RUNNING. The
 * runtime does not diff, does not rate-limit and does not decide when a value
 * is worth keeping: it delivers the current bytes every cycle and the decision
 * of what to do with them is yours.
 *
 * That means a driver over slow storage MUST NOT write through on every call.
 * Hold the bytes and commit on your own schedule — every ten seconds, on a
 * value change, on a shutdown signal — whatever the medium can sustain. An
 * EEPROM rated for 100k cycles would be consumed in under an hour by a 20 ms
 * scan writing through. Comparing against what is already stored, and skipping
 * the commit when nothing moved, belongs here too: the runtime cannot know what
 * a write costs on your board, so it does not try to guess.
 *
 * ALSO COMMITS THE PROGRAM IDENTITY held from the last openplc_retain_read(),
 * so the stored blob and the identity of the program that produced it are
 * written as one unit.
 *
 * MUST RETURN PROMPTLY AND MUST NOT BLOCK. This runs inside the scan cycle, so
 * time spent here is time the PLC is not scanning; a slow implementation shows
 * up as a scan overrun. Same contract as hardwareStateSwitch(). */
openplc_retain_status_t openplc_retain_write(const uint8_t *blob, uint16_t len);

/* Commit anything still held, now.
 *
 * Called once on the transition into STOP, after the last scan and before the
 * program is re-initialised. A HINT, NOT THE DURABILITY MECHANISM — see the
 * warning at the top of this file. Its only job is to make a clean stop
 * lossless for a driver that buffers: a store that already commits inside
 * write() has nothing to do here and should simply answer OK.
 *
 * Must not block for long, and must leave the store readable: the PLC can be
 * started again without the board rebooting, and the next
 * openplc_retain_read() has to see what this committed. */
openplc_retain_status_t openplc_retain_flush(void);

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_RETAIN_H
