/**
 * @file no_panel.c
 * Links the baremetal HMI host with no panel driver, as firmware for a board without one: the host's weak panel
 * defaults must link, and hmi_bm_init must leave the HMI off.
 */
#include <stdio.h>
#include <string.h>

#include "arduino_runtime_glue.h"
#include "hmi_baremetal.h"

static uint32_t g_now;

static uint32_t fake_clock(void) {
    return g_now += 5u;
}

uint16_t openplc_debug_size(uint8_t arr, uint16_t elem) {
    (void)arr;
    (void)elem;
    return 0;
}

uint16_t openplc_debug_read(uint8_t arr, uint16_t elem, uint8_t *dest) {
    (void)arr;
    (void)elem;
    (void)dest;
    return 0;
}

uint8_t openplc_debug_write(uint8_t arr, uint16_t elem, const uint8_t *bytes, uint16_t len) {
    (void)arr;
    (void)elem;
    (void)bytes;
    (void)len;
    return OPENPLC_DEBUG_STATUS_OUT_OF_BOUNDS;
}

int main(void) {
    if (hmi_bm_init(fake_clock) || hmi_bm_active()) {
        printf("FAIL the HMI started without a panel driver\n");
        return 1;
    }
    uint32_t before = g_now;
    hmi_bm_task(10000u);
    if (g_now != before) {
        printf("FAIL an inactive HMI did work\n");
        return 1;
    }
    printf("ok\n");
    return 0;
}
