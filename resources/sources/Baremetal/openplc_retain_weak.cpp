/*
openplc_retain_weak.cpp - Weak fallback backend for retain storage (NODE-94)
Copyright (C) 2026 OpenPLC - Thiago Alves

Guarantees the firmware always links even when no platform provides retain
storage. A VPP that ships a real backend defines the STRONG symbols, which
override these at link time. When absent, these run and report UNSUPPORTED, so
a board with no retention degrades to exactly what it did before the interface
existed: every retained variable starts at its declared initial value, which is
IEC's NON_RETAIN.

Same mechanism, and the same reasoning, as license_store_weak.cpp.
*/
#include "openplc_retain.h"

__attribute__((weak)) uint16_t openplc_retain_capacity(void)
{
    return 0;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_write(const uint8_t *, uint16_t)
{
    return OPLC_RETAIN_UNSUPPORTED;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_read(uint8_t *, uint16_t, uint16_t *out_len)
{
    // Zero the length even on the unsupported path: a caller that ignores the
    // status and reads `out_len` would otherwise act on an uninitialised
    // count, which is the kind of thing that surfaces once, in the field, as
    // a restore from bytes nobody wrote.
    if (out_len) *out_len = 0;
    return OPLC_RETAIN_UNSUPPORTED;
}

__attribute__((weak)) openplc_retain_status_t openplc_retain_clear(void)
{
    // OK rather than UNSUPPORTED: "discard what is stored" is satisfied by a
    // backend that stores nothing. Reporting failure here would make the
    // editor's post-upload reset look broken on every board without retention.
    return OPLC_RETAIN_OK;
}
