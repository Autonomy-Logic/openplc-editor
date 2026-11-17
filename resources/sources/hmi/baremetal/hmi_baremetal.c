/**
 * @file hmi_baremetal.c
 * @brief HMI host of the Baremetal firmware (hmi_baremetal.h): one viewer on the default session, PLC variables through
 *        the firmware's debugger functions, and a scheduler that starts a work unit only when its learned cost fits
 *        in the scan's slack. Work units: a logic frame, which cannot be split, and rows of a changed band, which are
 *        rasterized against a deadline and dropped, to be redrawn in fewer rows, when it passes.
 */
#include "hmi_baremetal.h"

#include <string.h>

#include "arduino_runtime_glue.h"
#include "hmi_config.h"
#include "hmi_core.h"
#include "hmi_panel.h"
#include "hmi_unit.h"

#ifndef HMI_BAND_BYTES
#define HMI_BAND_BYTES 20480
#endif
#ifndef HMI_PANEL_DENSITY
#define HMI_PANEL_DENSITY 1
#endif
/** Slack kept free before the next scan; no work unit starts in it. */
#ifndef HMI_BM_GUARD_US
#define HMI_BM_GUARD_US 1000u
#endif
/** Smallest raster window worth starting, besides the list walk every band pays. */
#ifndef HMI_BM_MIN_RENDER_US
#define HMI_BM_MIN_RENDER_US 300u
#endif
/** Touch polling period. */
#ifndef HMI_BM_TOUCH_MS
#define HMI_BM_TOUCH_MS 15u
#endif
/** Most time a test readout may hold the display list. */
#define HMI_BM_HOLD_MS 2000u
/** Color of the frame drawn once the screens raised an IEC fault. */
#define HMI_BM_FAULT_COLOR 0x000000u
/** Largest debugger value the host converts: a STRING's length byte and its payload window. */
#define HMI_BM_WIRE_MAX 256u

/** Bands the panel in hmi_config.h needs; a panel reporting more is drawn whole every frame. */
#if defined(HMI_PANEL_WIDTH) && defined(HMI_PANEL_HEIGHT) && (HMI_BAND_BYTES / (HMI_PANEL_WIDTH * 4)) > 0
#define HMI_BM_BAND_ROWS (HMI_BAND_BYTES / (HMI_PANEL_WIDTH * 4))
#define HMI_BM_MAX_BANDS ((HMI_PANEL_HEIGHT + HMI_BM_BAND_ROWS - 1) / HMI_BM_BAND_ROWS)
#else
#define HMI_BM_MAX_BANDS 64
#endif

/** Life cycle of the host. */
typedef enum { BM_OFF, BM_IDLE, BM_RASTER } bm_state_t;

/** Everything the host keeps between calls. */
typedef struct {
    bm_state_t state;
    hmi_bm_clock_fn clock;
    void *unit;
    bool faulted;
    int pw, ph, rows, nbands;
    bool tracked;
    int32_t scale_q8, offx, offy;
    uint32_t last_us, us_acc, ms;
    uint32_t last_frame_ms, last_touch_ms;
    bool touch_down;
    int touch_x, touch_y;
    const uint8_t *dl;
    size_t dl_len;
    uint64_t dl_hash;
    bool drawn_once, hash_valid;
    int band_y;
    bool band_aborted;
    uint32_t est_logic_us;
    uint32_t hash_us;
    uint32_t push_row_q8;
    bool held;
    uint32_t held_ms;
    hmi_bm_stats_t stats;
    uint32_t band_hash[HMI_BM_MAX_BANDS];
    uint32_t new_hash[HMI_BM_MAX_BANDS];
    uint8_t dirty[HMI_BM_MAX_BANDS];
    uint16_t band_try[HMI_BM_MAX_BANDS];
    uint32_t row_q8[HMI_BM_MAX_BANDS];
} bm_host_t;

static bm_host_t g;
static uint32_t g_band_words[(HMI_BAND_BYTES + 3) / 4];

/** The band buffer as RGBA bytes. */
static uint8_t *band_buffer(void) {
    return (uint8_t *)g_band_words;
}

static uint32_t now_us(void) {
    return g.clock();
}

/** Advances the millisecond time the screens see from the microsecond clock. */
static void tick(void) {
    uint32_t t = now_us();
    g.us_acc += t - g.last_us;
    g.last_us = t;
    g.ms += g.us_acc / 1000u;
    g.us_acc %= 1000u;
}

static bool target_little_endian(void) {
    const uint16_t probe = 1;
    uint8_t first;
    memcpy(&first, &probe, 1);
    return first == 1;
}

/** Copies n bytes between little-endian buffer format and the target's order. */
static void copy_ordered(uint8_t *dst, const uint8_t *src, size_t n) {
    if (target_little_endian()) {
        memcpy(dst, src, n);
        return;
    }
    for (size_t i = 0; i < n; i++) dst[i] = src[n - 1 - i];
}

/** Debugger address of a tag; false when it does not fit the debugger's (u8, u16) addressing. */
static bool tag_address(int tag, uint8_t *arr, uint16_t *elem) {
    if (tag < 0 || tag >= hmi_tag_count) return false;
    if (hmi_tags[tag].arr > UINT8_MAX || hmi_tags[tag].elem > UINT16_MAX) return false;
    *arr = (uint8_t)hmi_tags[tag].arr;
    *elem = (uint16_t)hmi_tags[tag].elem;
    return true;
}

static bool tag_read(void *ctx, int tag, void *dest) {
    (void)ctx;
    uint8_t arr;
    uint16_t elem;
    if (!dest || !tag_address(tag, &arr, &elem)) return false;
    const uint16_t dsize = openplc_debug_size(arr, elem);
    if (dsize == 0 || dsize > HMI_BM_WIRE_MAX) return false;
    uint8_t wire[HMI_BM_WIRE_MAX];
    if (openplc_debug_read(arr, elem, wire) != dsize) return false;
    uint8_t *out = (uint8_t *)dest;
    const hmi_tag_t *t = &hmi_tags[tag];
    if (t->type == HMI_TAG_STRING) {
        size_t n = wire[0];
        if (n > (size_t)dsize - 1u) n = (size_t)dsize - 1u;
        if (n > t->max_len) n = t->max_len;
        memcpy(out, wire + 1, n);
        out[n] = '\0';
        return true;
    }
    if (hmi_tag_size(tag) != dsize) return false;
    if (t->type == HMI_TAG_BOOL) {
        out[0] = wire[0] != 0 ? 1u : 0u;
        return true;
    }
    copy_ordered(out, wire, dsize);
    return true;
}

static void tag_write(void *ctx, int tag, const void *src) {
    (void)ctx;
    uint8_t arr;
    uint16_t elem;
    if (!src || !tag_address(tag, &arr, &elem)) return;
    const uint16_t dsize = openplc_debug_size(arr, elem);
    if (dsize == 0 || dsize > HMI_BM_WIRE_MAX) return;
    uint8_t wire[HMI_BM_WIRE_MAX];
    const uint8_t *in = (const uint8_t *)src;
    const hmi_tag_t *t = &hmi_tags[tag];
    if (t->type == HMI_TAG_STRING) {
        size_t n = 0;
        while (n < t->max_len && in[n] != '\0') n++;
        if (n > (size_t)dsize - 1u) n = (size_t)dsize - 1u;
        memset(wire, 0, dsize);
        wire[0] = (uint8_t)n;
        memcpy(wire + 1, in, n);
    } else if (hmi_tag_size(tag) != dsize) {
        return;
    } else if (t->type == HMI_TAG_BOOL) {
        wire[0] = in[0] != 0 ? 1u : 0u;
    } else {
        copy_ordered(wire, in, dsize);
    }
    (void)openplc_debug_write(arr, elem, wire, dsize);
}

static const hmi_tag_access_t g_access = {tag_read, tag_write, NULL};

/** Keeps the worst recent cost, decaying by 1/8 per sample so estimates follow lighter frames. */
static void learn(uint32_t *estimate, uint32_t took) {
    uint32_t decayed = *estimate - *estimate / 8u;
    *estimate = took > decayed ? took : decayed;
}

/** Learned-cost slot of the band at row y. */
static int band_slot(int y) {
    return g.tracked ? y / g.rows : 0;
}

/** What a logic frame draws: the PIN entry while the panel is locked, else the screens, blank after a fault. */
static void draw_frame(void) {
    if (hmi_lock_active()) {
        hmi_lock_draw();
        return;
    }
    if (!g.faulted && !hmi_unit_frame(g.unit)) g.faulted = true;
    if (g.faulted) hmi_clear(HMI_BM_FAULT_COLOR);
}

/** Marks the bands that changed since the last drawn frame. */
static void mark_dirty_bands(void) {
    uint32_t t0 = now_us();
    bool hashed = g.tracked && hmi_raster_band_hashes(g.dl, g.dl_len, g.pw, g.ph, g.rows, g.scale_q8, g.offx, g.offy,
                                                      g.new_hash, g.nbands) == HMI_RASTER_OK;
    g.hash_us = now_us() - t0;
    if (!hashed) {
        g.hash_valid = false;
        return;
    }
    for (int i = 0; i < g.nbands; i++) {
        g.dirty[i] = (uint8_t)(!g.hash_valid || g.new_hash[i] != g.band_hash[i]);
        g.band_hash[i] = g.new_hash[i];
    }
    g.hash_valid = true;
}

/**
 * Runs one logic frame, locking the panel when its screen code signed out; afterwards the host rasterizes it unless its
 * display list is unchanged.
 */
static void logic_frame(void) {
    uint32_t t0 = now_us();
    g.last_frame_ms = g.ms;
    hmi_set_time_ms(g.ms);
    hmi_frame_begin();
    draw_frame();
    g.dl = hmi_frame_end(&g.dl_len);
    if (hmi_frame_sign_out()) hmi_lock();
    uint64_t hash = hmi_frame_hash();
    if (!g.drawn_once || hash != g.dl_hash) {
        g.dl_hash = hash;
        g.drawn_once = true;
        mark_dirty_bands();
        g.band_y = 0;
        g.state = BM_RASTER;
    }
    uint32_t took = now_us() - t0;
    g.stats.last_logic_us = took;
    learn(&g.est_logic_us, took);
}

/** Whether row y needs drawing in the current frame. */
static bool band_dirty(int y) {
    return !g.tracked || !g.hash_valid || g.dirty[y / g.rows] != 0;
}

static void skip_clean_bands(void) {
    while (g.band_y < g.ph && !band_dirty(g.band_y)) g.band_y += g.rows;
    if (g.band_y > g.ph) g.band_y = g.ph;
}

/**
 * Rasterizes up to max_rows rows of the current band and pushes them. With a clock the raster stops at deadline_us
 * and the rows are dropped; a full-size attempt that is dropped halves the band's row count. Returns false when no
 * rows were pushed.
 */
static bool draw_rows(hmi_clock_fn clock, uint32_t deadline_us, int max_rows, bool gap_fill) {
    int slot = band_slot(g.band_y);
    int band_end = (g.band_y / g.rows + 1) * g.rows;
    if (band_end > g.ph) band_end = g.ph;
    int h = band_end - g.band_y;
    if (h > max_rows) h = max_rows;
    uint8_t *rgba = band_buffer();
    for (int i = 0; i < g.pw * h; i++) {
        rgba[i * 4 + 0] = 0;
        rgba[i * 4 + 1] = 0;
        rgba[i * 4 + 2] = 0;
        rgba[i * 4 + 3] = 255;
    }
    uint32_t t0 = now_us();
    int rc = hmi_raster_render_until(g.dl, g.dl_len, rgba, g.pw, g.ph, g.pw, g.band_y, h, g.scale_q8, g.offx, g.offy,
                                     clock, deadline_us);
    uint32_t t1 = now_us();
    uint32_t walk = g.hash_us;
    if (rc == HMI_RASTER_ABORTED) {
        uint32_t floor_q8 = ((t1 - t0 > walk ? t1 - t0 - walk : 0u) << 8) / (uint32_t)h;
        if (floor_q8 > g.row_q8[slot]) g.row_q8[slot] = floor_q8;
        if (!gap_fill) {
            g.band_aborted = true;
            g.band_try[slot] = (uint16_t)(h > 1 ? h / 2 : 1);
        }
        return false;
    }
    if (rc != HMI_RASTER_OK) {
        g.band_y = g.ph;
        return false;
    }
    hmi_panel_push_band(g.band_y, h, rgba, g.pw);
    uint32_t t2 = now_us();
    g.stats.bands_pushed++;
    if (t2 - t0 > g.stats.worst_band_us) g.stats.worst_band_us = t2 - t0;
    learn(&g.push_row_q8, ((t2 - t1) << 8) / (uint32_t)h);
    g.row_q8[slot] = ((t1 - t0 > walk ? t1 - t0 - walk : 0u) << 8) / (uint32_t)h;
    int tried = g.band_try[slot] != 0 ? g.band_try[slot] : g.rows;
    g.band_y += h;
    if (g.band_y >= band_end) {
        if (!g.band_aborted && h == tried && tried < g.rows)
            g.band_try[slot] = (uint16_t)(tried * 2 < g.rows ? tried * 2 : g.rows);
        g.band_aborted = false;
    }
    return true;
}

/** Draws every changed band of the current frame with no deadline (startup only). */
static void draw_whole_frame(void) {
    for (skip_clean_bands(); g.band_y < g.ph; skip_clean_bands()) draw_rows(NULL, 0, g.rows, false);
    g.state = BM_IDLE;
    g.stats.frames_drawn++;
}

/** Draws as many rows of the current frame as fit in the slack left since t0. */
static void raster_slice(uint32_t t0, uint32_t slack_us) {
    for (;;) {
        skip_clean_bands();
        if (g.band_y >= g.ph) {
            g.state = BM_IDLE;
            g.stats.frames_drawn++;
            return;
        }
        uint32_t spent = now_us() - t0;
        if (spent + HMI_BM_GUARD_US >= slack_us) return;
        uint32_t left = slack_us - spent - HMI_BM_GUARD_US;
        int slot = band_slot(g.band_y);
        int rows = g.band_try[slot] != 0 ? g.band_try[slot] : g.rows;
        uint32_t per_row = g.push_row_q8 + g.row_q8[slot];
        per_row += per_row / 8u;
        uint32_t fixed = g.hash_us + g.hash_us / 8u + HMI_BM_MIN_RENDER_US;
        uint64_t room = left > fixed ? (uint64_t)(left - fixed) << 8 : 0u;
        int fit = per_row > 0 ? (int)(room / per_row > (uint64_t)rows ? (uint64_t)rows : room / per_row) : rows;
        if (fit < 1) return;
        uint32_t push = (uint32_t)(((uint64_t)g.push_row_q8 * (uint32_t)fit) >> 8);
        push += push / 8u;
        if (left <= push) return;
        if (!draw_rows(g.clock, now_us() + left - push, fit, fit < rows)) return;
    }
}

/** Panel pixels to Q4 logical units. */
static int32_t px_to_q4(int px, int32_t offset) {
    return (int32_t)(((int64_t)(px - offset) * 4096) / g.scale_q8);
}

static void poll_touch(void) {
    if (g.ms - g.last_touch_ms < HMI_BM_TOUCH_MS) return;
    g.last_touch_ms = g.ms;
    int x = 0, y = 0;
    bool down = hmi_panel_read_touch(&x, &y);
    if (down) {
        hmi_input_pointer(g.touch_down ? HMI_PTR_MOVE : HMI_PTR_DOWN, px_to_q4(x, g.offx), px_to_q4(y, g.offy));
        g.touch_x = x;
        g.touch_y = y;
    } else if (g.touch_down) {
        hmi_input_pointer(HMI_PTR_UP, px_to_q4(g.touch_x, g.offx), px_to_q4(g.touch_y, g.offy));
    }
    g.touch_down = down;
}

bool hmi_bm_init(hmi_bm_clock_fn clock_us) {
    memset(&g, 0, sizeof g);
    if (!clock_us) return false;
    g.clock = clock_us;
    int w = 0, h = 0;
    if (!hmi_panel_init(&w, &h) || w <= 0 || h <= 0) return false;
    const int density = HMI_PANEL_DENSITY > 0 ? HMI_PANEL_DENSITY : 1;
    const int32_t lw = w / density, lh = h / density;
    if (lw <= 0 || lh <= 0) return false;
    g.rows = (int)(HMI_BAND_BYTES / ((uint32_t)w * 4u));
    if (g.rows <= 0) return false;
    if (g.rows > h) g.rows = h;
    g.pw = w;
    g.ph = h;
    g.nbands = (h + g.rows - 1) / g.rows;
    g.tracked = g.nbands <= HMI_BM_MAX_BANDS;
    g.scale_q8 = (int32_t)density * 256;
    g.offx = (w - lw * density) / 2;
    g.offy = (h - lh * density) / 2;

    hmi_session_use(NULL);
    hmi_core_init(lw, lh);
    hmi_lock_setup(hmi_panel_pin, hmi_relock_minutes * 60000u);
    hmi_set_tag_access(&g_access);
    g.unit = hmi_unit_create();
    if (!g.unit) return false;
    hmi_unit_set_role(g.unit, HMI_ROLE_ADMIN);

    g.last_us = now_us();
    logic_frame();
    if (g.state == BM_RASTER) draw_whole_frame();
    g.state = BM_IDLE;
    return true;
}

bool hmi_bm_active(void) {
    return g.state != BM_OFF;
}

void hmi_bm_task(uint32_t slack_us) {
    if (g.state == BM_OFF || slack_us <= HMI_BM_GUARD_US) return;
    uint32_t t0 = now_us();
    tick();
    if (g.held && g.ms - g.held_ms >= HMI_BM_HOLD_MS) g.held = false;
    poll_touch();
    if (g.state == BM_RASTER) {
        raster_slice(t0, slack_us);
    } else if (!g.held && g.ms - g.last_frame_ms >= hmi_frame_ms) {
        uint32_t spent = now_us() - t0;
        uint32_t need = spent + HMI_BM_GUARD_US + g.est_logic_us + g.est_logic_us / 8u;
        if (need < slack_us) logic_frame();
    }
    if (now_us() - t0 > slack_us) g.stats.scan_overruns++;
}

#ifdef HMI_TEST_READOUT
int32_t hmi_bm_dl_hold(void) {
    if (g.state == BM_OFF || !g.dl || g.dl_len == 0 || g.dl_len > INT32_MAX) return -1;
    g.held = true;
    g.held_ms = g.ms;
    return (int32_t)g.dl_len;
}

int32_t hmi_bm_dl_read(uint32_t offset, uint8_t *out, int32_t max) {
    if (!g.held || !out || max < 0) return -1;
    if (offset >= g.dl_len) return 0;
    size_t n = g.dl_len - offset;
    if (n > (size_t)max) n = (size_t)max;
    memcpy(out, g.dl + offset, n);
    if (offset + n >= g.dl_len) g.held = false;
    return (int32_t)n;
}

void hmi_bm_stats(hmi_bm_stats_t *out) {
    if (out) *out = g.stats;
}
#endif

__attribute__((weak)) bool hmi_panel_init(int *width, int *height) {
    (void)width;
    (void)height;
    return false;
}

__attribute__((weak)) void hmi_panel_push_band(int y0, int rows, uint8_t *rgba, int width) {
    (void)y0;
    (void)rows;
    (void)rgba;
    (void)width;
}

__attribute__((weak)) bool hmi_panel_read_touch(int *x, int *y) {
    (void)x;
    (void)y;
    return false;
}
