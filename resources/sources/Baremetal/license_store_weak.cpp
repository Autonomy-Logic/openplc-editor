/*
license_store_weak.cpp - Weak fallback backend for the license store.
Copyright (C) 2022 OpenPLC - Thiago Alves

Guarantees the firmware always links even when no platform VPP provides a real
backend. A VPP that ships license_store_<arch>.cpp defines the STRONG symbols,
which override these weak defaults at link time. When absent, these run and
report LIC_STORE_UNSUPPORTED, so the licensing FCs degrade gracefully.
*/
#include "license_store.h"

__attribute__((weak)) lic_store_status_t license_store_write(const uint8_t *, size_t)
{ return LIC_STORE_UNSUPPORTED; }

__attribute__((weak)) lic_store_status_t license_store_read(uint8_t *, size_t, size_t *out_len)
{ if (out_len) *out_len = 0; return LIC_STORE_UNSUPPORTED; }

__attribute__((weak)) lic_store_status_t license_store_erase(void)
{ return LIC_STORE_UNSUPPORTED; }
