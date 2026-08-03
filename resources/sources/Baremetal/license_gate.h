/*
license_gate.h - License enforcement gate (verify + demo window).
The closed license-core (prebuilt) provides the STRONG implementation (verify +
15-minute demo timer). The open firmware ships a weak default that reports
UNSUPPORTED and allows actuation, so boards without a license-core behave as
before. The clock is injected (now_ms) so the core stays host-testable.
*/
#ifndef LICENSE_GATE_H
#define LICENSE_GATE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LIC_GATE_FULL = 0,          /* valid license -> full operation */
    LIC_GATE_DEMO = 1,          /* no/invalid license -> demo window running */
    LIC_GATE_DEMO_EXPIRED = 2,  /* demo window elapsed -> actuation must stop */
    LIC_GATE_UNSUPPORTED = 3,   /* no license-core linked (weak default) -> unenforced */
} lic_gate_state_t;

/* 15 minutes. Overridable at build (-DLIC_GATE_DEMO_MS=...) for bench tests
 * that must watch the demo expire in seconds; production keeps the default. */
#ifndef LIC_GATE_DEMO_MS
#define LIC_GATE_DEMO_MS 900000u
#endif

/*
 * Verify the stored blob once and arm the gate.
 *   blob / blob_len - the 98 bytes read out of on-device storage.
 *   now_ms          - injected clock, so the core stays host-testable.
 *
 * The device anchor is NOT a parameter: license_core reads it from the silicon
 * inside the closed artifact (ADR-0003). It used to be passed in from the sketch,
 * which made the identity a claim the open firmware could rewrite.
 */
void license_gate_init(const uint8_t *blob, size_t blob_len, uint32_t now_ms);
lic_gate_state_t license_gate_state(uint32_t now_ms);
int license_gate_actuation_allowed(uint32_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* LICENSE_GATE_H */
