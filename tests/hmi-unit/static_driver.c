/**
 * @file static_driver.c
 * Host for builds with HMI_STATIC_MEMORY, as a microcontroller runs the unit: the default session and the one static
 * program instance. Prints the frames of a short script; run.mjs requires the same output from a heap build.
 */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_unit.h"
#include "ids.h"

static unsigned char g_plc[16][64];
static uint32_t g_now;

static bool plc_read(void *ctx, int tag, void *dest) {
    (void)ctx;
    memcpy(dest, g_plc[tag], hmi_tag_size(tag));
    return true;
}

static void plc_write(void *ctx, int tag, const void *src) {
    (void)ctx;
    memset(g_plc[tag], 0, sizeof g_plc[tag]);
    memcpy(g_plc[tag], src, hmi_tag_size(tag));
}

static const hmi_tag_access_t g_access = {plc_read, plc_write, NULL, NULL};

static void frame(void *unit, const char *label) {
    hmi_set_time_ms(g_now);
    g_now += 50;
    hmi_frame_begin();
    hmi_unit_frame(unit);
    size_t len = 0;
    hmi_frame_end(&len);
    printf("%s page=%d len=%zu dl=%016llx status=%u\n", label, (int)hmi_page(), len,
           (unsigned long long)hmi_frame_hash(), (unsigned)hmi_frame_status());
}

static void tap(void *unit, const char *label, int32_t id) {
    const int32_t *b = hmi_bounds_data();
    for (int i = 0; i < hmi_bounds_count(); i++, b += 5) {
        if (b[0] != id) continue;
        int32_t x = b[1] + b[3] / 2, y = b[2] + b[4] / 2;
        hmi_input_pointer(HMI_PTR_DOWN, x, y);
        frame(unit, label);
        hmi_input_pointer(HMI_PTR_UP, x, y);
        frame(unit, label);
        return;
    }
    printf("element %d not drawn\n", (int)id);
    exit(1);
}

int main(void) {
    hmi_set_tag_access(&g_access);
    void *unit = hmi_unit_create();
    if (!unit) {
        printf("no program instance\n");
        return 1;
    }
    hmi_core_init(480, 320);
    hmi_unit_set_role(unit, HMI_ROLE_ADMIN);
    frame(unit, "start");
    frame(unit, "steady");
    tap(unit, "run", ID_OVERVIEW_RUN);
    hmi_unit_destroy(unit);
    unit = hmi_unit_create();
    if (!unit) {
        printf("no program instance after destroy\n");
        return 1;
    }
    hmi_unit_set_role(unit, HMI_ROLE_ADMIN);
    frame(unit, "again");
    hmi_unit_destroy(unit);
    return 0;
}
