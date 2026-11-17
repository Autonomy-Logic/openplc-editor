/*
 * Stand-in for resources/sources/hmi/preview/hmi_preview_host.cpp with the same exports, for the Jest tests of the
 * preview runtime. Rebuild fake-preview-host.wasm with `node tests/hmi-preview/build-fixture.mjs`.
 *
 * Behaviour: init refuses a zero width (out of memory); a frame at time 999 traps; render marks rows 2..5 dirty after
 * a setter changed something, every row on the first render, none otherwise; setter 1 of screen 0 exists; key 1 calls
 * WASI fd_write (the page answers it as not supported) and key 2 calls proc_exit.
 */
#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(name)))

static int32_t g_width, g_height, g_page, g_design, g_frames, g_status, g_dirty, g_first = 1, g_dirty_y0, g_dirty_rows;
static int32_t g_last_pointer[3], g_last_key;
static uint8_t g_rgba[16 * 8 * 4];
static int32_t g_bounds[2 * 5] = {1, 16, 32, 160, 80, 2, 0, 0, 16, 16};
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
/* What the tests read back: the last pointer (kind, x, y in Q4), the last key, the design flag and the set value. */
EXPORT("fake_pointer") const int32_t *fake_pointer(void) { return g_last_pointer; }
EXPORT("fake_key") int32_t fake_key(void) { return g_last_key; }
EXPORT("fake_design") int32_t fake_design(void) { return g_design; }
EXPORT("fake_value") double fake_value(void) { return g_value; }
EXPORT("fake_text") const char *fake_text(void) { return g_text; }
