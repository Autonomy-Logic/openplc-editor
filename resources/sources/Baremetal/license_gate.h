/*
license_gate.h - License enforcement gate (verify + demo window).
The closed license-core (prebuilt) provides the STRONG implementation (verify +
2-hour demo timer). The open firmware ships a weak default that reports
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

/* 2 hours (product decision 2026-08-18; was 15 minutes). Overridable at build
 * (-DLIC_GATE_DEMO_MS=...) for bench tests that must watch the demo expire in
 * seconds; production keeps the default. */
#ifndef LIC_GATE_DEMO_MS
#define LIC_GATE_DEMO_MS 7200000u
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

/*
 * Status QUERY — reporting, never enforcement. It writes no state at all: it
 * cannot arm the demo window (EDGE-595) and it cannot latch its expiry
 * (review 2026-08-19) — it only reflects what init or enforcement decided.
 * So a diagnostic caller handing in a garbage timestamp can misread the
 * state, but cannot end (or extend) the demo window for the rest of the boot.
 */
lic_gate_state_t license_gate_state(uint32_t now_ms);

/*
 * Enforcement before init is NOT a free pass (EDGE-595): the first enforcement
 * call (this or license_gate_outputs_permitted) arms the same demo window an
 * unlicensed init would, counting LIC_GATE_DEMO_MS from that call. A firmware
 * that never calls license_gate_init() therefore degrades to demo instead of
 * actuating forever. A later init with a VALID blob still reaches FULL; an
 * invalid one keeps the already-running window (no restart).
 *
 * ENFORCEMENT LATCHES EXPIRY (E2E review 2026-08-18, scoped to enforcement
 * 2026-08-19): the first enforcement verdict of DEMO_EXPIRED is permanent for
 * the rest of the boot, so the 32-bit millis() wraparound (~49.7 days) cannot
 * reopen a closed window, and neither can feeding enforcement an older
 * timestamp afterwards. Consequence, and it fails CLOSED: one absurd
 * timestamp fed to THIS entry point past the window ends the demo for the
 * boot. The last-mile check (license_gate_outputs_permitted) takes no caller
 * clock at all. A VALID licence is never latched out: FULL wins before the
 * latch is consulted, and an activation done while expired recovers at the
 * next boot's init.
 */
int license_gate_actuation_allowed(uint32_t now_ms);

/*
 * May outputs be driven RIGHT NOW? Takes no clock on purpose.
 *
 * This is the question a signed HAL asks at the top of its own raw output write,
 * so that calling `hal_write_outputs` directly -- which open code can do, the
 * symbol is declared in openplc.h -- cannot skip the gate the way it did when the
 * only check lived inside updateOutputBuffers().
 *
 * No now_ms parameter because the caller must not choose the time: an entry point
 * that accepts a timestamp accepts the boot timestamp forever. The gate reads a
 * monotonic clock inside the closed artifact instead.
 *
 * Returns 1 when actuation is allowed (FULL, or a demo window still running) and
 * 0 once the demo has expired. Before init it arms the lazy demo window on the
 * platform clock, like license_gate_actuation_allowed (EDGE-595): a missing
 * init is a missing licence, not a licence.
 */
int license_gate_outputs_permitted(void);

/*
 * Report THIS board's licensing identity: `device_id`, not the anchor.
 *
 * Writes LIC_DEVICE_ID_SIZE bytes into `out` and returns that count, or returns
 * 0 when this board has no identity a licence can be bound to. The constant is
 * declared in license_blob.h, next to the field it has to match.
 *
 * REPORTING, NEVER ENFORCEMENT. Nothing about actuation consults this, and the
 * verifier does not either: `license_core_verify` re-reads the silicon through
 * `license_platform_anchor()` and derives the id again internally, so what this
 * function hands the open firmware is a value to PUBLISH (FC 0x48 -> the editor
 * -> the purchase), never a claim the gate believes. Reporting an identity and
 * asserting one stay different things (Baremetal.ino).
 *
 * IT RETURNS THE DIGEST AND NEVER THE ANCHOR, and that is the security
 * property, not an implementation detail. The raw anchor is a permanent,
 * non-rotatable factory serial (an ESP32 eFuse MAC, an AVR signature row);
 * the digest is domain-separated and licensing-specific. Before DOPE-589 FC
 * 0x48 published the anchor itself on an unauthenticated channel. Handing the
 * anchor back from here would restore that disclosure behind a new name.
 *
 * ZERO IS A REFUSAL, never a zero-length identity -- the same contract
 * `license_platform_anchor` and `arduino_unique_id_read` state, for the same
 * reason: sha256(domain || <nothing>) is a CONSTANT, so a zero-length anchor
 * would give every such board one shared device_id and a single signed blob
 * would licence the whole population. Callers propagate the refusal; the
 * editor's licensing flow already treats a zero-length reply as "no licence
 * can be bound to this board" (license-flow.ts, deriveIdentity).
 *
 * The weak default in the open firmware returns 0, so a board with no
 * license-core reports no identity, which is what it is. A LICENSABLE board
 * cannot reach that default: the packaging rules refuse to publish a licensable
 * VPP whose closed archive is not wired in (licensable-wiring.ts), and rule #48
 * refuses a stale archive -- which is what keeps an archive built before this
 * function existed from silently answering 0 on a paid board.
 */
size_t license_gate_device_id(uint8_t *out, size_t cap);

#ifdef LIC_HOST_TEST
/*
 * HOST-TEST SEAM, absent from every device build by construction -- only a build
 * that defines `LIC_HOST_TEST` (the license-core/test Makefile, nothing else)
 * gets this symbol, so it is not in any artifact a VPP ships: neither the
 * Arduino `.a` nor the runtime-v4 Linux objects. It has to be absent:
 * `license_gate_init` refuses a second call specifically so open code cannot
 * re-arm the demo window, and an exported "forget you were initialised" would
 * hand that back with a nicer name.
 *
 * The host tests need it because they exercise FULL, expiry and millis-wrap as
 * separate scenarios against one set of file-scope statics.
 */
void license_gate_reset_for_test(void);
#endif

#ifdef __cplusplus
}
#endif

#endif /* LICENSE_GATE_H */
