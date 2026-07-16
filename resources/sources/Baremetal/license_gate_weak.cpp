/*
license_gate_weak.cpp - Weak fallback for the license enforcement gate.
Copyright (C) 2022 OpenPLC - Thiago Alves

Guarantees the firmware always links even when no platform VPP provides a real
license-core. The VPP's prebuilt license-core (.a) defines the STRONG symbols
(ECDSA verify + 15-minute demo timer), which override these weak defaults at
link time. When absent, these run: the gate reports LIC_GATE_UNSUPPORTED and
actuation stays unconditionally allowed, so a board without a license-core
behaves exactly as it did before licensing existed (no enforcement).
*/
#include "license_gate.h"

__attribute__((weak)) void license_gate_init(const uint8_t *blob, size_t blob_len,
                                             const uint8_t *anchor, size_t anchor_len,
                                             uint32_t now_ms)
{
    (void)blob;
    (void)blob_len;
    (void)anchor;
    (void)anchor_len;
    (void)now_ms;
}

__attribute__((weak)) lic_gate_state_t license_gate_state(uint32_t now_ms)
{
    (void)now_ms;
    return LIC_GATE_UNSUPPORTED;
}

__attribute__((weak)) int license_gate_actuation_allowed(uint32_t now_ms)
{
    (void)now_ms;
    return 1;
}
