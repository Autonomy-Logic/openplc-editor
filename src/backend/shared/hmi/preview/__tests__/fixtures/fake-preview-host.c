/*
 * Stand-in for resources/sources/hmi/preview/hmi_preview_host.cpp with the same exports, for the Jest tests of the
 * preview runtime. Rebuild fake-preview-host.wasm with `node tests/hmi-preview/build-fixture.mjs`.
 *
 * Behaviour: init refuses a zero width (out of memory); a frame at time 999 traps; render marks rows 2..5 dirty after
 * a setter changed something, every row on the first render, none otherwise; setter 1 of screen 0 exists; key 1 calls
 * WASI fd_write (the page answers it as not supported) and key 2 calls proc_exit. Live elements get ids from 100;
 * type 7 cannot be added, nor anything into a live parent that does not exist; setter 1 of a live element exists for numbers and texts. Every live call is logged as
 * (call, a, b, c, d, e) for fake_live: 1 add (type, parent, kind, before, draw_before), 2 set number (element,
 * setter, value), 3 set text (element, setter), 4 remove (element), 5 detach (element, parent, kind), 6 attach (element, parent, kind, before,
 * draw_before). Any element below 100, and any live one, can be detached once and attached back once detached.
 */
#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(name)))

static int32_t g_width, g_height, g_page, g_design, g_frames, g_status, g_dirty, g_first = 1, g_dirty_y0, g_dirty_rows;
static int32_t g_last_pointer[3], g_last_key;
static uint8_t g_rgba[16 * 8 * 4];
static int32_t g_bounds[2 * 5] = {1, 16, 32, 160, 80, 2, 0, 0, 16, 16};
/* Drawn extent x0, y0, x1, y1 in Q4 lu: 2 x 3 lu at (1, 2). */
static int32_t g_drawn[4] = {16, 32, 48, 80};
static char g_text[256];
static double g_value;

EXPORT("hmi_pv_init") int32_t hmi_pv_init(int32_t w, int32_t h) {
    if (w == 0) return -1;
    g_width = w;
    g_height = h;
    return 0;
}
EXPORT("hmi_pv_resize") void hmi_pv_resize(int32_t w, int32_t h) { g_width = w; g_height = h; }
EXPORT("hmi_pv_design") void hmi_pv_design(int32_t on) { g_design = on; }
EXPORT("hmi_pv_show") void hmi_pv_show(int32_t page) { g_page = page; g_dirty = 1; }
EXPORT("hmi_pv_page") int32_t hmi_pv_page(void) { return g_page; }
EXPORT("hmi_pv_frame") uint32_t hmi_pv_frame(uint32_t t) {
    if (t == 999) __builtin_trap();
    g_frames++;
    g_status = (int32_t)(t == 500);
    return 20;
}
EXPORT("hmi_pv_status") uint32_t hmi_pv_status(void) { return (uint32_t)g_status; }
EXPORT("hmi_pv_render") uint8_t *hmi_pv_render(int32_t w, int32_t h, int32_t scale_q8, int32_t ox, int32_t oy) {
    (void)ox, (void)oy;
    if (w <= 0 || h <= 0 || w * h > 16 * 8) return 0;
    for (int i = 0; i < w * h * 4; i++) g_rgba[i] = (uint8_t)(i + scale_q8 + g_frames);
    g_dirty_y0 = g_first ? 0 : 2;
    g_dirty_rows = g_first ? h : (g_dirty ? 4 : 0);
    g_first = 0;
    g_dirty = 0;
    return g_rgba;
}
EXPORT("hmi_pv_dirty_y0") int32_t hmi_pv_dirty_y0(void) { return g_dirty_y0; }
EXPORT("hmi_pv_dirty_rows") int32_t hmi_pv_dirty_rows(void) { return g_dirty_rows; }
EXPORT("hmi_pv_pointer") void hmi_pv_pointer(int32_t kind, int32_t x, int32_t y) {
    g_last_pointer[0] = kind, g_last_pointer[1] = x, g_last_pointer[2] = y;
}
__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_write"))) int32_t wasi_fd_write(int32_t, int32_t, int32_t, int32_t);
__attribute__((import_module("wasi_snapshot_preview1"), import_name("proc_exit"))) void wasi_proc_exit(int32_t);

EXPORT("hmi_pv_key") void hmi_pv_key(uint32_t code) {
    g_last_key = (int32_t)code;
    if (code == 1) g_last_key = wasi_fd_write(1, 0, 0, 0);
    if (code == 2) wasi_proc_exit(1);
}
EXPORT("hmi_pv_bounds_count") int32_t hmi_pv_bounds_count(void) { return 2; }
EXPORT("hmi_pv_bounds") const int32_t *hmi_pv_bounds(void) { return g_bounds; }
EXPORT("hmi_pv_drawn") const int32_t *hmi_pv_drawn(void) { return g_drawn; }
EXPORT("hmi_pv_set_num") int32_t hmi_pv_set_num(int32_t screen, int32_t setter, double v) {
    if (screen != 0 || setter != 1) return -1;
    g_value = v;
    g_dirty = 1;
    return 0;
}
EXPORT("hmi_pv_text") char *hmi_pv_text(void) { return g_text; }
EXPORT("hmi_pv_set_str") int32_t hmi_pv_set_str(int32_t screen, int32_t setter) {
    if (screen != 0 || setter != 1) return -1;
    g_dirty = g_text[0] != 0;
    return 0;
}
static int32_t g_live_log[64 * 6], g_live_calls, g_next_live = 100, g_live[16], g_live_count;

static void live_log(int32_t call, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e) {
    if (g_live_calls >= 64) return;
    int32_t *row = &g_live_log[g_live_calls++ * 6];
    row[0] = call, row[1] = a, row[2] = b, row[3] = c, row[4] = d, row[5] = e;
}
static int live_known(int32_t id) {
    for (int i = 0; i < g_live_count; i++)
        if (g_live[i] == id) return 1;
    return 0;
}
EXPORT("hmi_pv_live_add") int32_t hmi_pv_live_add(int32_t type, int32_t parent, int32_t kind, int32_t before, int32_t draw) {
    live_log(1, type, parent, kind, before, draw);
    if (type == 7 || g_live_count >= 16 || (parent >= 100 && !live_known(parent))) return -1;
    g_live[g_live_count++] = g_next_live;
    g_dirty = 1;
    return g_next_live++;
}
EXPORT("hmi_pv_live_set_num") int32_t hmi_pv_live_set_num(int32_t element, int32_t setter, double v) {
    live_log(2, element, setter, (int32_t)v, 0, 0);
    if (!live_known(element) || setter != 1) return -1;
    g_value = v;
    return 0;
}
EXPORT("hmi_pv_live_set_str") int32_t hmi_pv_live_set_str(int32_t element, int32_t setter) {
    live_log(3, element, setter, 0, 0, 0);
    return live_known(element) && setter == 1 ? 0 : -1;
}
EXPORT("hmi_pv_live_remove") int32_t hmi_pv_live_remove(int32_t element) {
    live_log(4, element, 0, 0, 0, 0);
    for (int i = 0; i < g_live_count; i++)
        if (g_live[i] == element) {
            g_live[i] = g_live[--g_live_count];
            return 0;
        }
    return -1;
}
static int32_t g_off[16], g_off_count;

static int off_index(int32_t element) {
    for (int i = 0; i < g_off_count; i++)
        if (g_off[i] == element) return i;
    return -1;
}
EXPORT("hmi_pv_live_detach") int32_t hmi_pv_live_detach(int32_t element, int32_t parent, int32_t kind) {
    live_log(5, element, parent, kind, 0, 0);
    if (off_index(element) >= 0 || (element >= 100 && !live_known(element)) || g_off_count >= 16) return -1;
    g_off[g_off_count++] = element;
    g_dirty = 1;
    return 0;
}
EXPORT("hmi_pv_live_attach")
int32_t hmi_pv_live_attach(int32_t element, int32_t parent, int32_t kind, int32_t before, int32_t draw) {
    live_log(6, element, parent, kind, before, draw);
    const int i = off_index(element);
    if (i < 0) return -1;
    g_off[i] = g_off[--g_off_count];
    g_dirty = 1;
    return element;
}
/* What the tests read back: the last pointer (kind, x, y in Q4), the last key, the design flag and the set value. */
EXPORT("fake_pointer") const int32_t *fake_pointer(void) { return g_last_pointer; }
EXPORT("fake_key") int32_t fake_key(void) { return g_last_key; }
EXPORT("fake_design") int32_t fake_design(void) { return g_design; }
EXPORT("fake_value") double fake_value(void) { return g_value; }
EXPORT("fake_text") const char *fake_text(void) { return g_text; }
EXPORT("fake_live_calls") int32_t fake_live_calls(void) { return g_live_calls; }
EXPORT("fake_live") const int32_t *fake_live(void) { return g_live_log; }
