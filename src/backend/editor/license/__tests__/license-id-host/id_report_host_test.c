/*
 * id_report_host_test.c - Generic board-ID layer against stubbed VPP hooks: factory ID first,
 * generated ID fallback, degenerate IDs refused, and the raw ID report frame.
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "license_board_id.h"
#include "license_platform.h"

static uint8_t g_hw[LIC_ANCHOR_MAX + 8u];
static size_t  g_hw_len = 0u;
static uint8_t g_slot[LIC_BOARD_ID_SIZE];
static size_t  g_slot_len = 0u;
static int     g_failures = 0;

size_t hardwareUniqueId(uint8_t *out, size_t cap)
{
    if (g_hw_len == 0u || cap < g_hw_len)
        return 0u;
    memcpy(out, g_hw, g_hw_len);
    return g_hw_len;
}

size_t license_board_id_read(uint8_t *out, size_t cap)
{
    if (g_slot_len == 0u || out == NULL || cap < g_slot_len)
        return 0u;
    memcpy(out, g_slot, g_slot_len);
    return g_slot_len;
}

int license_board_id_write(const uint8_t *id, size_t len)
{
    (void)id;
    (void)len;
    return 0;
}

static void check_int(const char *name, long got, long want)
{
    int ok = (got == want);
    if (!ok)
        g_failures++;
    printf("[%s] %-44s got=%ld want=%ld\n", ok ? "PASS" : "FAIL", name, got, want);
}

static void set_hw(const uint8_t *id, size_t len)
{
    memcpy(g_hw, id, len);
    g_hw_len = len;
}

static void set_slot(const uint8_t *id, size_t len)
{
    memcpy(g_slot, id, len);
    g_slot_len = len;
}

int main(void)
{
    static const uint8_t factory[6] = {0x24, 0x6f, 0x28, 0x9a, 0x01, 0xc4};
    static const uint8_t generated[LIC_BOARD_ID_SIZE] = {0x3d, 0x91, 0x07, 0xc4, 0x5e, 0xa2, 0x18, 0x6b,
                                                         0xf0, 0x29, 0x84, 0xd7, 0x4b, 0x63, 0x0e, 0xb5};
    uint8_t anchor[LIC_ANCHOR_MAX];
    uint8_t report[LIC_ID_REPORT_MAX];
    uint8_t filled[LIC_BOARD_ID_SIZE];
    uint8_t kind = 0u;

    /* No factory ID, empty slot. */
    check_int("no ID -> no anchor", (long)license_platform_anchor(anchor, sizeof(anchor), &kind), 0);
    check_int("no ID -> report length 1", (long)license_id_report(report, sizeof(report)), 1);
    check_int("no ID -> count 0", report[0], 0);

    /* Generated ID only. */
    set_slot(generated, sizeof(generated));
    check_int("slot -> 16-byte anchor", (long)license_platform_anchor(anchor, sizeof(anchor), &kind),
              LIC_BOARD_ID_SIZE);
    check_int("slot anchor equals stored id", memcmp(anchor, generated, LIC_BOARD_ID_SIZE) == 0, 1);
    check_int("slot anchor kind generated", kind, LIC_ID_KIND_GENERATED);
    check_int("small buffer refused", (long)license_platform_anchor(anchor, LIC_BOARD_ID_SIZE - 1u, &kind), 0);
    check_int("NULL kind refused", (long)license_platform_anchor(anchor, sizeof(anchor), NULL), 0);
    memset(report, 0, sizeof(report));
    check_int("slot report length 3 + 16", (long)license_id_report(report, sizeof(report)), 3 + LIC_BOARD_ID_SIZE);
    check_int("slot report frame", report[0] == 1u && report[1] == LIC_ID_KIND_GENERATED && report[2] == 16u, 1);
    check_int("slot report bytes raw", memcmp(&report[3], generated, LIC_BOARD_ID_SIZE) == 0, 1);
    check_int("report refuses a short buffer", (long)license_id_report(report, LIC_ID_REPORT_MAX - 1u), 0);

    /* Factory ID wins over the slot. */
    set_hw(factory, sizeof(factory));
    check_int("factory -> 6-byte anchor", (long)license_platform_anchor(anchor, sizeof(anchor), &kind), 6);
    check_int("factory anchor kind hardware", kind, LIC_ID_KIND_HARDWARE);
    memset(report, 0, sizeof(report));
    check_int("factory report length 3 + 6", (long)license_id_report(report, sizeof(report)), 9);
    check_int("factory report frame", report[0] == 1u && report[1] == LIC_ID_KIND_HARDWARE && report[2] == 6u, 1);
    check_int("factory report bytes raw", memcmp(&report[3], factory, sizeof(factory)) == 0, 1);

    /* A degenerate factory ID falls back to the slot. */
    memset(filled, 0xFF, sizeof(filled));
    set_hw(filled, 8u);
    check_int("all-FF factory -> slot", (long)license_platform_anchor(anchor, sizeof(anchor), &kind),
              LIC_BOARD_ID_SIZE);
    check_int("fallback kind generated", kind, LIC_ID_KIND_GENERATED);

    /* A factory ID longer than the report allows falls back too. */
    memset(g_hw, 0x5a, sizeof(g_hw));
    g_hw[0] = 0x01;
    g_hw_len = LIC_ANCHOR_MAX + 1u;
    check_int("oversized factory -> slot", (long)license_platform_anchor(anchor, sizeof(anchor), &kind),
              LIC_BOARD_ID_SIZE);
    check_int("oversized fallback kind generated", kind, LIC_ID_KIND_GENERATED);
    g_hw_len = 0u;

    /* Degenerate or short slots are refused. */
    memset(filled, 0xFF, sizeof(filled));
    set_slot(filled, sizeof(filled));
    check_int("all-FF slot refused", (long)license_platform_anchor(anchor, sizeof(anchor), &kind), 0);
    memset(filled, 0x00, sizeof(filled));
    set_slot(filled, sizeof(filled));
    check_int("all-00 slot refused", (long)license_platform_anchor(anchor, sizeof(anchor), &kind), 0);
    set_slot(generated, 8u);
    check_int("short slot refused", (long)license_platform_anchor(anchor, sizeof(anchor), &kind), 0);

    printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "ALL PASS", g_failures);
    return g_failures ? 1 : 0;
}
