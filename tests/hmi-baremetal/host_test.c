/**
 * @file host_test.c
 * Drives the baremetal HMI host (resources/sources/hmi/baremetal) as Baremetal.ino does, in simulated time: a fake
 * 320x240 panel that keeps the pushed pixels, a fake clock that advances with the work done, and a fake debugger
 * table for the sample project's tags. Exits non-zero on the first failed check.
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
#include "ids.h"

#define PANEL_W 320
#define PANEL_H 240
/** Simulated cost of the work the fakes stand for, in microseconds. */
#define CLOCK_STEP_US 2u
#define DEBUG_READ_US 30u
#define PUSH_ROW_US 120u
#define TOUCH_READ_US 20u
#define IDLE_LOOP_US 25u
#define TAG_SLOTS 16
#define WIRE_MAX 256

static uint32_t g_now;
static uint8_t g_fb[PANEL_H][PANEL_W * 4];
static uint8_t g_ref[PANEL_H][PANEL_W * 4];
static bool g_touch;
static int g_touch_x, g_touch_y;
static unsigned g_reads, g_writes, g_pushes, g_pushed_rows;
static unsigned g_overruns, g_checked_frames;
static uint8_t g_wire[TAG_SLOTS][WIRE_MAX];
static int g_last_write_tag = -1;
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
    if (width != PANEL_W || y0 < 0 || rows <= 0 || y0 + rows > PANEL_H) {
        printf("FAIL bad push y0=%d rows=%d width=%d\n", y0, rows, width);
        exit(1);
    }
    memcpy(g_fb[y0], rgba, (size_t)rows * PANEL_W * 4);
    memset(rgba, 0xA5, (size_t)rows * PANEL_W * 4); /* drivers may convert in place */
    g_pushes++;
    g_pushed_rows += (unsigned)rows;
    g_now += (uint32_t)rows * PUSH_ROW_US;
}

bool hmi_panel_read_touch(int *x, int *y) {
    g_now += TOUCH_READ_US;
    if (!g_touch) return false;
    *x = g_touch_x;
    *y = g_touch_y;
    return true;
}

/** Slot of the tag at a debugger address, -1 when the unit has none there. */
static int slot_of(uint8_t arr, uint16_t elem) {
    for (int i = 0; i < hmi_tag_count && i < TAG_SLOTS; i++)
        if (hmi_tags[i].arr == arr && hmi_tags[i].elem == elem) return i;
    return -1;
}

uint16_t openplc_debug_size(uint8_t arr, uint16_t elem) {
    int s = slot_of(arr, elem);
    if (s < 0) return 0;
    return hmi_tags[s].type == HMI_TAG_STRING ? OPENPLC_DEBUG_STRING_WIRE : (uint16_t)hmi_tag_size(s);
}

uint16_t openplc_debug_read(uint8_t arr, uint16_t elem, uint8_t *dest) {
    uint16_t n = openplc_debug_size(arr, elem);
    g_now += DEBUG_READ_US;
    g_reads++;
    if (n > 0) memcpy(dest, g_wire[slot_of(arr, elem)], n);
    return n;
}

uint8_t openplc_debug_write(uint8_t arr, uint16_t elem, const uint8_t *bytes, uint16_t len) {
    int s = slot_of(arr, elem);
    if (s < 0 || len != openplc_debug_size(arr, elem)) return OPENPLC_DEBUG_STATUS_OUT_OF_BOUNDS;
    memcpy(g_wire[s], bytes, len);
    g_writes++;
    g_last_write_tag = s;
    return OPENPLC_DEBUG_STATUS_OK;
}

/** Index of the tag whose path ends with suffix. */
static int tag_named(const char *suffix) {
    size_t n = strlen(suffix);
    for (int i = 0; i < hmi_tag_count; i++) {
        size_t m = strlen(hmi_tags[i].path);
        if (m >= n && strcmp(hmi_tags[i].path + m - n, suffix) == 0) return i;
    }
    printf("FAIL no tag %s\n", suffix);
    exit(1);
}

/** The panel must show exactly the core's full render of the display list the host holds. */
static void check_panel(const char *when) {
    static uint8_t dl[256 * 1024];
    int32_t total = hmi_bm_dl_hold();
    CHECK(total > 0 && (size_t)total <= sizeof dl, "%s: no display list to read (%d)", when, (int)total);
    if (total <= 0 || (size_t)total > sizeof dl) return;
    uint32_t got = 0;
    while (got < (uint32_t)total) {
        int32_t n = hmi_bm_dl_read(got, dl + got, 200);
        CHECK(n > 0, "%s: readout stopped at %u of %d", when, (unsigned)got, (int)total);
        if (n <= 0) return;
        got += (uint32_t)n;
    }
    CHECK(hmi_bm_dl_read(0, dl, 1) < 0, "%s: the display list is still held after the last chunk", when);
    for (int y = 0; y < PANEL_H; y++)
        for (int x = 0; x < PANEL_W; x++) {
            g_ref[y][x * 4 + 0] = 0;
            g_ref[y][x * 4 + 1] = 0;
            g_ref[y][x * 4 + 2] = 0;
            g_ref[y][x * 4 + 3] = 255;
        }
    int rc = hmi_raster_render(dl, (size_t)total, &g_ref[0][0], PANEL_W, PANEL_H, PANEL_W, 0, PANEL_H, 256, 0, 0);
    CHECK(rc == HMI_RASTER_OK, "%s: reference render failed (%d)", when, rc);
    CHECK(memcmp(g_fb, g_ref, sizeof g_fb) == 0, "%s: the panel differs from the full render of its display list",
          when);
    g_checked_frames++;
}

/**
 * Runs scan cycles as Baremetal.ino does: the scan takes scan_us, then the loop hands the HMI the slack left until the
 * next scan. Checks every finished frame against a full render and counts calls that overran their slack.
 */
static void run_cycles(int cycles, uint32_t cycle_us, uint32_t scan_us) {
    for (int c = 0; c < cycles; c++) {
        uint32_t start = g_now;
        g_now += scan_us;
        for (;;) {
            uint32_t used = g_now - start;
            if (used >= cycle_us) break;
            uint32_t slack = cycle_us - used;
            hmi_bm_stats_t before;
            hmi_bm_stats(&before);
            uint32_t t0 = g_now;
            hmi_bm_task(slack);
            uint32_t took = g_now - t0;
            if (took > slack) {
                g_overruns++;
                printf("overrun: %u us in a slack of %u us\n", (unsigned)took, (unsigned)slack);
            }
            hmi_bm_stats_t after;
            hmi_bm_stats(&after);
            if (after.frames_drawn != before.frames_drawn) check_panel("frame");
            g_now += IDLE_LOOP_US;
        }
        if (g_now - start < cycle_us) g_now = start + cycle_us;
    }
}

/** Presses the panel at (x, y) for press_ms, then releases it for as long. */
static void tap_px(int x, int y, uint32_t press_ms) {
    g_touch = true;
    g_touch_x = x;
    g_touch_y = y;
    run_cycles((int)(press_ms / 10u), 10000u, 3000u);
    g_touch = false;
    run_cycles((int)(press_ms / 10u), 10000u, 3000u);
}

/** Taps PIN key i (0..8 digits 1-9, 9 Clear, 10 digit 0, 11 OK) on the 320x240 PIN entry. */
static void tap_key(int i) {
    tap_px(8 + (i % 3) * 103 + 48, 72 + (i / 3) * 41 + 17, 80u);
}

/** Centre of element id in panel pixels, from the last frame's bounds; false when it was not drawn. */
static bool element_px(int32_t id, int *x, int *y) {
    const int32_t *b = hmi_bounds_data();
    for (int i = 0; i < hmi_bounds_count(); i++, b += 5) {
        if (b[0] != id) continue;
        *x = (int)((b[1] + b[3] / 2) / 16);
        *y = (int)((b[2] + b[4] / 2) / 16);
        return true;
    }
    return false;
}

int main(void) {
    CHECK(hmi_bm_init(fake_clock), "hmi_bm_init failed");
    CHECK(hmi_bm_active(), "the HMI is not active after init");
    check_panel("first frame");

    run_cycles(50, 10000u, 3000u);
    CHECK(g_reads == 0 && g_writes == 0, "locked panel read %u and wrote %u tags", g_reads, g_writes);
    tap_key(0);
    tap_key(1);
    tap_key(9);
    CHECK(g_reads == 0, "a wrong PIN digit and Clear ran the screens");
    tap_key(1);
    tap_key(3);
    tap_key(5);
    tap_key(7);
    tap_key(11);
    run_cycles(20, 10000u, 3000u);
    CHECK(g_reads > 0, "the right PIN did not unlock the panel");
    CHECK(g_writes == 0, "unlocking wrote %u tags", g_writes);
    printf("unlocked: %u tag reads\n", g_reads);

    run_cycles(30, 10000u, 3000u);
    unsigned pushes = g_pushes;
    run_cycles(100, 10000u, 3000u);
    CHECK(g_pushes == pushes, "a steady screen pushed %u bands", g_pushes - pushes);

    int level = tag_named(".LEVEL");
    float v = 7.5f;
    memcpy(g_wire[level], &v, sizeof v);
    unsigned rows = g_pushed_rows;
    run_cycles(30, 10000u, 3000u);
    CHECK(g_pushed_rows > rows, "a changed tag drew nothing");
    CHECK(g_pushed_rows - rows < PANEL_H, "a changed tag pushed %u rows, the whole panel", g_pushed_rows - rows);
    printf("level change: %u rows pushed\n", g_pushed_rows - rows);

    int x = 0, y = 0;
    CHECK(element_px(ID_OVERVIEW_RUN, &x, &y), "Run is not drawn");
    int running = tag_named(".RUNNING");
    tap_px(x, y, 80u);
    run_cycles(10, 10000u, 3000u);
    CHECK(g_last_write_tag == running && g_wire[running][0] == 1, "tapping Run did not write it (last write %d)",
          g_last_write_tag);

    CHECK(element_px(ID_OVERVIEW_LEAVE, &x, &y), "Sign out is not drawn");
    tap_px(x, y, 80u);
    run_cycles(10, 10000u, 3000u);
    unsigned signed_out = g_reads;
    run_cycles(30, 10000u, 3000u);
    CHECK(g_reads == signed_out, "signing out left the screens running (%u reads)", g_reads - signed_out);
    tap_key(1);
    tap_key(3);
    tap_key(5);
    tap_key(7);
    tap_key(11);
    run_cycles(20, 10000u, 3000u);
    CHECK(g_reads > signed_out, "the PIN did not unlock the panel after signing out");
    printf("signed out and unlocked again\n");

    hmi_bm_stats_t tight;
    hmi_bm_stats(&tight);
    for (int i = 0; i < 6; i++) {
        v = (float)i;
        memcpy(g_wire[level], &v, sizeof v);
        run_cycles(60, 5000u, 2600u);
    }
    hmi_bm_stats_t after_tight;
    hmi_bm_stats(&after_tight);
    CHECK(after_tight.frames_drawn > tight.frames_drawn, "no frame finished with 2.4 ms of slack");

    g_now += 301u * 1000u * 1000u;
    run_cycles(10, 10000u, 3000u);
    unsigned reads = g_reads;
    run_cycles(50, 10000u, 3000u);
    CHECK(g_reads == reads, "an idle panel kept running the screens (%u reads)", g_reads - reads);

    hmi_bm_stats_t s;
    hmi_bm_stats(&s);
    CHECK(g_overruns == 0 && s.scan_overruns == 0, "%u calls overran their slack (host counted %u)", g_overruns,
          (unsigned)s.scan_overruns);
    printf("frames %u (checked %u), bands %u, overruns %u, last logic %u us, worst band %u us\n",
           (unsigned)s.frames_drawn, g_checked_frames, (unsigned)s.bands_pushed, (unsigned)s.scan_overruns,
           (unsigned)s.last_logic_us, (unsigned)s.worst_band_us);
    if (g_failures > 0) {
        printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    printf("ok\n");
    return 0;
}
