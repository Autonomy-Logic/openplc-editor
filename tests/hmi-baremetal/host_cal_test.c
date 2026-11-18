/**
 * @file host_cal_test.c
 * The baremetal HMI host of a panel whose touch needs calibrating, in simulated time: a fake 320x240 panel whose
 * resistive touch reports raw readings mirrored and skewed, and a fake non-volatile store kept in a file, so run.mjs
 * can restart the firmware against the same store.
 *
 *   host_cal_test <store-file> calibrate|stored|hold|miss
 *
 *   calibrate  the calibration screen shows at startup; five taps calibrate and store it, then the PIN entry works
 *   stored     the stored calibration is used: no calibration screen, and the PIN entry works at once
 *   hold       with a stored calibration, a press held from startup for 5 s opens the calibration screen
 *   miss       targets tapped out of order start the calibration over; the next five calibrate
 *
 * Exits non-zero on the first failed check.
 */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "arduino_runtime_glue.h"
#include "hmi_baremetal.h"
#include "hmi_core.h"
#include "hmi_panel.h"
#include "hmi_unit.h"

#define PANEL_W 320
#define PANEL_H 240
#define CLOCK_STEP_US 2u
#define DEBUG_READ_US 30u
#define PUSH_ROW_US 60u
#define TOUCH_US 200u
#define IDLE_LOOP_US 25u

static uint32_t g_now;
static const char *g_store;
static bool g_touch;
static int g_touch_x, g_touch_y;
static unsigned g_reads, g_store_writes;
static unsigned g_overruns;
static int g_failures;

#define CHECK(cond, ...)                                                                                               \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            printf("FAIL %s:%d: ", __FILE__, __LINE__);                                                                \
            printf(__VA_ARGS__);                                                                                       \
            printf("\n");                                                                                              \
            g_failures++;                                                                                              \
        }                                                                                                              \
    } while (0)

static uint32_t fake_clock(void) {
    uint32_t t = g_now;
    g_now += CLOCK_STEP_US;
    return t;
}

bool hmi_panel_init(int *width, int *height) {
    *width = PANEL_W;
    *height = PANEL_H;
    return true;
}

void hmi_panel_push_band(int y0, int rows, uint8_t *rgba, int width) {
    (void)y0;
    (void)rgba;
    (void)width;
    g_now += (uint32_t)rows * PUSH_ROW_US;
}

/** Raw readings of panel pixel (x, y): X mirrored, both axes scaled and slightly crossed, as a resistive panel reads. */
static void raw_of(int x, int y, int32_t *rx, int32_t *ry) {
    *rx = 3900 - x * 11 + y / 4;
    *ry = 250 + y * 14 + x / 5;
}

bool hmi_panel_read_touch_raw(int32_t *x, int32_t *y) {
    g_now += TOUCH_US;
    if (!g_touch) return false;
    raw_of(g_touch_x, g_touch_y, x, y);
    return true;
}

bool hmi_panel_store_read(uint8_t *buf, size_t len) {
    FILE *f = fopen(g_store, "rb");
    if (!f) return false;
    size_t n = fread(buf, 1, len, f);
    fclose(f);
    return n == len;
}

bool hmi_panel_store_write(const uint8_t *buf, size_t len) {
    FILE *f = fopen(g_store, "wb");
    if (!f) return false;
    size_t n = fwrite(buf, 1, len, f);
    fclose(f);
    g_store_writes++;
    return n == len;
}

uint16_t openplc_debug_size(uint8_t arr, uint16_t elem) {
    for (int i = 0; i < hmi_tag_count; i++)
        if (hmi_tags[i].arr == arr && hmi_tags[i].elem == elem)
            return hmi_tags[i].type == HMI_TAG_STRING ? OPENPLC_DEBUG_STRING_WIRE : (uint16_t)hmi_tag_size(i);
    return 0;
}

uint16_t openplc_debug_read(uint8_t arr, uint16_t elem, uint8_t *dest) {
    uint16_t n = openplc_debug_size(arr, elem);
    g_now += DEBUG_READ_US;
    g_reads++;
    memset(dest, 0, n);
    return n;
}

uint8_t openplc_debug_write(uint8_t arr, uint16_t elem, const uint8_t *bytes, uint16_t len) {
    (void)arr;
    (void)elem;
    (void)bytes;
    (void)len;
    return OPENPLC_DEBUG_STATUS_OK;
}

/** Scan cycles as Baremetal.ino runs them: a 3 ms scan every 10 ms, the HMI in the slack; counts overruns. */
static void run_cycles(int cycles) {
    for (int c = 0; c < cycles; c++) {
        uint32_t start = g_now;
        g_now += 3000u;
        for (;;) {
            uint32_t used = g_now - start;
            if (used >= 10000u) break;
            uint32_t slack = 10000u - used;
            uint32_t t0 = g_now;
            hmi_bm_task(slack);
            if (g_now - t0 > slack) g_overruns++;
            g_now += IDLE_LOOP_US;
        }
        if (g_now - start < 10000u) g_now = start + 10000u;
    }
}

/** Presses panel pixel (x, y) for 100 ms, then releases it for as long. */
static void tap(int x, int y) {
    g_touch = true;
    g_touch_x = x;
    g_touch_y = y;
    run_cycles(10);
    g_touch = false;
    run_cycles(10);
}

/** Taps the calibration targets of a 320x240 panel: the four corners inset 30 pixels, then the centre. */
static void calibrate(void) {
    static const int targets[5][2] = {{30, 30}, {290, 30}, {290, 210}, {30, 210}, {160, 120}};
    for (int i = 0; i < 5; i++) tap(targets[i][0], targets[i][1]);
}

/** Enters the sample project's PIN 2468 and checks that the screens run afterwards. */
static void unlock(const char *when) {
    static const int keys[5] = {1, 3, 5, 7, 11};
    for (int k = 0; k < 5; k++) tap(8 + (keys[k] % 3) * 103 + 48, 72 + (keys[k] / 3) * 41 + 17);
    unsigned reads = g_reads;
    run_cycles(20);
    CHECK(g_reads > reads, "%s: the PIN did not unlock the panel", when);
}

int main(int argc, char **argv) {
    if (argc != 3) {
        printf("usage: host_cal_test <store-file> calibrate|stored|hold|miss\n");
        return 2;
    }
    g_store = argv[1];
    const char *scenario = argv[2];
    bool hold = strcmp(scenario, "hold") == 0;
    if (hold) {
        g_touch = true;
        g_touch_x = 100;
        g_touch_y = 100;
    }
    CHECK(hmi_bm_init(fake_clock), "hmi_bm_init failed");
    run_cycles(5);

    if (strcmp(scenario, "stored") == 0) {
        CHECK(!hmi_cal_active(), "a stored calibration was not used");
        unlock("stored");
        CHECK(g_store_writes == 0, "a stored calibration was written again");
    } else if (strcmp(scenario, "calibrate") == 0 || strcmp(scenario, "miss") == 0) {
        CHECK(hmi_cal_active(), "the calibration screen did not show at startup");
        CHECK(g_reads == 0, "the screens ran before the touch was calibrated");
        if (strcmp(scenario, "miss") == 0) {
            tap(290, 30);
            tap(30, 30);
            tap(290, 210);
            tap(30, 210);
            tap(160, 120);
            CHECK(hmi_cal_active() && g_store_writes == 0, "a calibration with targets out of order was kept");
        }
        calibrate();
        CHECK(!hmi_cal_active(), "five taps did not finish the calibration");
        CHECK(g_store_writes == 1, "the calibration was written %u times", g_store_writes);
        unlock(scenario);
    } else if (hold) {
        CHECK(!hmi_cal_active(), "a stored calibration was not used");
        run_cycles(400);
        CHECK(!hmi_cal_active(), "the calibration opened before 5 s");
        run_cycles(150);
        CHECK(hmi_cal_active(), "a press held from startup for 5 s did not open the calibration");
        g_touch = false;
        run_cycles(10);
        calibrate();
        CHECK(!hmi_cal_active() && g_store_writes == 1, "the calibration opened by a held press did not finish");
        unlock("hold");
    } else {
        printf("unknown scenario %s\n", scenario);
        return 2;
    }

    CHECK(g_overruns == 0, "%u calls overran their slack", g_overruns);
    if (g_failures > 0) {
        printf("%s: %d check(s) failed\n", scenario, g_failures);
        return 1;
    }
    printf("%s: ok\n", scenario);
    return 0;
}
