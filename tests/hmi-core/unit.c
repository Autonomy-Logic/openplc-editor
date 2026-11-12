/**
 * @file unit.c
 * Unit tests of the HMI core. Built three times by run.mjs, with font tables holding both faces, the regular face
 * only, and no face, so the fallbacks are tested too. Prints failures and exits non-zero.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_internal.h"

static int g_failures;
static int g_checks;

#define CHECK(cond)                                                                                                    \
    do {                                                                                                               \
        g_checks++;                                                                                                    \
        if (!(cond)) {                                                                                                 \
            g_failures++;                                                                                              \
            fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #cond);                                                 \
        }                                                                                                              \
    } while (0)

#define CHECK_EQ(a, b)                                                                                                 \
    do {                                                                                                               \
        long long va_ = (long long)(a), vb_ = (long long)(b);                                                          \
        g_checks++;                                                                                                    \
        if (va_ != vb_) {                                                                                              \
            g_failures++;                                                                                              \
            fprintf(stderr, "%s:%d: %s == %s (%lld != %lld)\n", __FILE__, __LINE__, #a, #b, va_, vb_);                 \
        }                                                                                                              \
    } while (0)

static const uint8_t *frame(size_t *len) { return hmi_frame_end(len); }

static uint32_t cmd_count(const uint8_t *dl) { return hmi_rd_u32(dl + 16); }

/* ---- trigonometry and formatting ---- */

static void test_trig(void) {
    CHECK_EQ(hmi_sin(0, 1000), 0);
    CHECK_EQ(hmi_sin(30, 1000), 500);
    CHECK_EQ(hmi_sin(90, 1000), 1000);
    CHECK_EQ(hmi_sin(180, 1000), 0);
    CHECK_EQ(hmi_sin(270, 1000), -1000);
    CHECK_EQ(hmi_sin(-90, 1000), -1000);
    CHECK_EQ(hmi_sin(450, 1000), 1000);
    CHECK_EQ(hmi_cos(0, 1000), 1000);
    CHECK_EQ(hmi_cos(60, 1000), 500);
    CHECK_EQ(hmi_cos(180, -200), 200);
    CHECK_EQ(hmi_cos(2147483647, 1000), hmi_cos(2147483647 % 360, 1000));
    for (int d = -720; d <= 720; d++) {
        int32_t s = hmi_sin(d, 10000), c = hmi_cos(d, 10000);
        double rs = sin((double)d * 3.14159265358979323846 / 180.0) * 10000.0;
        double rc = cos((double)d * 3.14159265358979323846 / 180.0) * 10000.0;
        CHECK(fabs((double)s - rs) <= 1.0 && fabs((double)c - rc) <= 1.0);
    }
}

static void test_format_int(void) {
    char b[16];
    CHECK_EQ(hmi_format_int(b, sizeof b, 0), 1);
    CHECK(strcmp(b, "0") == 0);
    hmi_format_int(b, sizeof b, -1);
    CHECK(strcmp(b, "-1") == 0);
    hmi_format_int(b, sizeof b, INT32_MIN);
    CHECK(strcmp(b, "-2147483648") == 0);
    hmi_format_int(b, sizeof b, INT32_MAX);
    CHECK(strcmp(b, "2147483647") == 0);
    CHECK_EQ(hmi_format_int(b, 4, 12345), 3);
    CHECK(strcmp(b, "123") == 0);
    CHECK_EQ(hmi_format_int(NULL, 4, 1), 0);
}

/* Same text as printf "%.*f" for every value and precision. */
static void check_real(float v, int d) {
    char mine[64], ref[64];
    hmi_format_real(mine, sizeof mine, v, d);
    snprintf(ref, sizeof ref, "%.*f", d, (double)v);
    g_checks++;
    if (strcmp(mine, ref) != 0) {
        g_failures++;
        fprintf(stderr, "format_real(%.9g, %d): '%s' != '%s'\n", (double)v, d, mine, ref);
    }
}

static void test_format_real(void) {
    static const float k_values[] = {0.0f, -0.0f, 0.5f, 1.5f, 2.5f, -2.5f, 0.125f, 0.375f, -0.001f, 0.0049f, 1e-7f,
                                     99.995f, 123456.789f, 4294967040.0f, 4294967296.0f, 1e20f, -1e20f, 3.4e38f};
    for (size_t i = 0; i < sizeof k_values / sizeof k_values[0]; i++)
        for (int d = 0; d <= 6; d++) check_real(k_values[i], d);
    static const float k_edges[] = {1e-7f, 1e-30f, 1.4e-45f, 1.17549435e-38f, 7.62939453e-6f, 1.52587891e-5f,
                                    0.5e-6f, 4.9999998e-7f, 9.5e-7f, 1e25f, 3.4028235e38f, -3.4028235e38f, 16777217.0f,
                                    0.05f, 0.15f, 0.25f, 0.35f, 2.5e-6f, 1099511627776.0f};
    for (size_t i = 0; i < sizeof k_edges / sizeof k_edges[0]; i++)
        for (int d = 0; d <= 6; d++) check_real(k_edges[i], d);
    char s[16];
    hmi_format_real(s, sizeof s, NAN, 2);
    CHECK(strcmp(s, "NaN") == 0);
    hmi_format_real(s, sizeof s, -NAN, 2);
    CHECK(strcmp(s, "NaN") == 0);
    hmi_format_real(s, sizeof s, INFINITY, 1);
    CHECK(strcmp(s, "Inf") == 0);
    hmi_format_real(s, sizeof s, -INFINITY, 0);
    CHECK(strcmp(s, "-Inf") == 0);
    uint32_t x = 12345;
    for (int i = 0; i < 200000; i++) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        float v;
        uint32_t bits = x;
        memcpy(&v, &bits, sizeof v);
        if (isnan(v) || isinf(v)) continue;
        check_real(v, (int)(x % 7));
        check_real((float)(int32_t)x / 1000.0f, (int)((x >> 3) % 7));
    }
    char b[4];
    CHECK_EQ(hmi_format_real(b, sizeof b, 3.4e38f, 0), 3);
    CHECK(strcmp(b, "339") == 0); /* 3.4e38f is 339999995...e38 */
    CHECK_EQ(hmi_format_real(b, sizeof b, 123.456f, 2), 3);
    CHECK(strcmp(b, "123") == 0);
    CHECK_EQ(hmi_format_real(b, 1, 1.0f, 0), 0);
    CHECK_EQ(b[0], 0);
    char c[16];
    hmi_format_real(c, sizeof c, 1.0f, -3);
    CHECK(strcmp(c, "1") == 0);
    hmi_format_real(c, sizeof c, 1.0f, 9);
    CHECK(strcmp(c, "1.000000") == 0);
}

/* ---- display list ---- */

static void test_display_list(void) {
    hmi_core_init(320, 240);
    hmi_frame_begin();
    hmi_fill_rect(1, 2, 3, 4, 0, 0x123456);
    hmi_clear(0xFF0000);
    size_t len;
    const uint8_t *dl = frame(&len);
    CHECK_EQ(hmi_rd_u32(dl), HMI_DL_MAGIC);
    CHECK_EQ(hmi_rd_u16(dl + 4), HMI_DL_VERSION);
    CHECK_EQ(hmi_rd_i32(dl + 8), 320);
    CHECK_EQ(hmi_rd_i32(dl + 12), 240);
    CHECK_EQ(cmd_count(dl), 2);
    CHECK_EQ(len, HMI_DL_HEADER_SIZE + 1 + HMI_PAYLOAD_RECT + 1 + HMI_PAYLOAD_CLEAR);
    const uint8_t *p = dl + HMI_DL_HEADER_SIZE;
    CHECK_EQ(p[0], HMI_OP_RECT);
    CHECK_EQ(hmi_rd_i32(p + 1), 16);
    CHECK_EQ(hmi_rd_i32(p + 5), 32);
    CHECK_EQ(hmi_rd_i32(p + 9), 48);
    CHECK_EQ(hmi_rd_i32(p + 13), 64);
    CHECK_EQ(hmi_rd_u32(p + 21), 0xFF123456u);
    CHECK_EQ(hmi_frame_status(), 0);
    uint64_t h1 = hmi_frame_hash();
    hmi_frame_begin();
    hmi_fill_rect(1, 2, 3, 4, 0, 0x123456);
    hmi_clear(0xFF0000);
    frame(&len);
    CHECK(hmi_frame_hash() == h1);

    /* Full display list: the rest of the frame is dropped, and what was kept still renders. */
    hmi_frame_begin();
    int added = 0;
    while (!(hmi_frame_status() & HMI_STATUS_DL_FULL)) {
        hmi_fill_rect(added % 300, 0, 10, 10, 0, 0x00FF00);
        added++;
    }
    hmi_clear(0x000000); /* would fit, but must not be recorded after a drop */
    dl = frame(&len);
    CHECK(len <= HMI_DL_CAPACITY);
    CHECK_EQ(cmd_count(dl), added - 1);
    uint8_t px[320 * 4];
    CHECK_EQ(hmi_raster_render(dl, len, px, 320, 240, 320, 0, 1, 256, 0, 0), HMI_RASTER_OK);

    /* A text longer than the limit is cut at a character boundary. */
    char longtext[600];
    for (int i = 0; i < 300; i++) {
        longtext[2 * i] = (char)0xC3;
        longtext[2 * i + 1] = (char)0xA9; /* e acute */
    }
    hmi_frame_begin();
    hmi_text(0, 0, longtext, 600, 10, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0);
    dl = frame(&len);
    CHECK(hmi_frame_status() & HMI_STATUS_TEXT_TRUNCATED);
    CHECK_EQ(hmi_rd_u16(dl + HMI_DL_HEADER_SIZE + 1 + 18), 254);

    /* Polygon points beyond the limit and the bounds table overflow are reported. */
    hmi_frame_begin();
    hmi_poly_begin(0);
    for (int i = 0; i < HMI_POLY_MAX + 5; i++) hmi_poly_point(i, i * i % 17);
    hmi_poly_end();
    for (int i = 0; i < HMI_BOUNDS_MAX + 1; i++) hmi_elem_bounds(i, 0, 0, 1, 1);
    dl = frame(&len);
    CHECK(hmi_frame_status() & HMI_STATUS_POLY_FULL);
    CHECK(hmi_frame_status() & HMI_STATUS_BOUNDS_FULL);
    CHECK_EQ(hmi_rd_u16(dl + HMI_DL_HEADER_SIZE + 1 + 4), HMI_POLY_MAX);
    CHECK_EQ(hmi_bounds_count(), HMI_BOUNDS_MAX);

    /* Fewer than three points draw nothing; a NULL text records an empty one. */
    hmi_frame_begin();
    hmi_poly_begin(0);
    hmi_poly_point(1, 1);
    hmi_poly_point(2, 2);
    hmi_poly_end();
    hmi_text(0, 0, NULL, 5, 10, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0);
    hmi_text(0, 0, "x", 1, 0, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0);
    dl = frame(&len);
    CHECK_EQ(cmd_count(dl), 1);
    CHECK_EQ(hmi_rd_u16(dl + HMI_DL_HEADER_SIZE + 1 + 18), 0);
}

/* ---- arcs: angles are normalised on the wire ---- */

static void test_arc_wire(void) {
    hmi_core_init(100, 100);
    hmi_frame_begin();
    hmi_arc(0, 0, 10, 2, -30, 1000, 0);
    hmi_arc(0, 0, 10, 2, 2147483647, -2147483647 - 1, 0);
    size_t len;
    const uint8_t *dl = frame(&len);
    const uint8_t *p = dl + HMI_DL_HEADER_SIZE + 1;
    CHECK_EQ(hmi_rd_i32(p + 16), 330 * 64);
    CHECK_EQ(hmi_rd_i32(p + 20), (330 + 360) * 64);
    p += HMI_PAYLOAD_ARC + 1;
    CHECK_EQ(hmi_rd_i32(p + 16), (2147483647 % 360) * 64);
    CHECK_EQ(hmi_rd_i32(p + 20), (2147483647 % 360 - 360) * 64);
}

/* ---- frames ---- */

static void test_frames(void) {
    hmi_core_init(400, 300);
    hmi_frame_begin();
    hmi_frame_set(32768, 100 * 16, 50 * 16, 0, 0, 0, 0, 0);
    hmi_fill_rect(10, 20, 30, 40, 2, 0);
    size_t len;
    const uint8_t *dl = frame(&len);
    const uint8_t *p = dl + HMI_DL_HEADER_SIZE + 1;
    CHECK_EQ(hmi_rd_i32(p), 105 * 16);
    CHECK_EQ(hmi_rd_i32(p + 4), 60 * 16);
    CHECK_EQ(hmi_rd_i32(p + 8), 15 * 16);
    CHECK_EQ(hmi_rd_i32(p + 12), 20 * 16);
    CHECK_EQ(hmi_rd_i32(p + 16), 16);

    /* Pointer reads go back through the frame, rounding toward minus infinity, and stop at its clip. */
    hmi_input_pointer(HMI_PTR_MOVE, 99 * 16, 50 * 16);
    hmi_frame_begin();
    hmi_frame_set(32768, 100 * 16, 50 * 16, 1, 100 * 16, 50 * 16, 50 * 16, 50 * 16);
    CHECK_EQ(hmi_ptr_x(), HMI_PTR_AWAY);
    hmi_frame_set(32768, 100 * 16, 50 * 16, 0, 0, 0, 0, 0);
    CHECK_EQ(hmi_ptr_x(), -2);
    CHECK_EQ(hmi_ptr_y(), 0);
    hmi_frame_reset();
    CHECK_EQ(hmi_ptr_x(), 99);

    /* A clip inside a clipped frame is intersected with the frame's clip; unclip returns to the frame's clip. */
    hmi_frame_begin();
    hmi_frame_set(65536, 0, 0, 1, 10 * 16, 10 * 16, 20 * 16, 20 * 16);
    hmi_clip(0, 0, 100, 15);
    hmi_unclip();
    hmi_frame_reset();
    hmi_unclip();
    dl = frame(&len);
    p = dl + HMI_DL_HEADER_SIZE;
    CHECK_EQ(p[0], HMI_OP_CLIP);
    CHECK_EQ(hmi_rd_i32(p + 1), 160);
    CHECK_EQ(hmi_rd_i32(p + 5), 160);
    CHECK_EQ(hmi_rd_i32(p + 9), 320);
    CHECK_EQ(hmi_rd_i32(p + 13), 80);
    p += 1 + HMI_PAYLOAD_CLIP;
    CHECK_EQ(p[0], HMI_OP_CLIP);
    CHECK_EQ(hmi_rd_i32(p + 13), 320);
    p += 1 + HMI_PAYLOAD_CLIP;
    CHECK_EQ(p[0], HMI_OP_UNCLIP);
}

/* ---- pointer and arbitration ---- */

static void test_pointer(void) {
    hmi_core_init(400, 300);
    hmi_frame_begin();
    CHECK_EQ(hmi_ptr_x(), HMI_PTR_AWAY); /* no pointer yet */
    frame(NULL);

    /* A tap within one frame: press this frame, release the next. */
    hmi_input_pointer(HMI_PTR_DOWN, 50 * 16, 60 * 16);
    hmi_input_pointer(HMI_PTR_UP, 50 * 16, 60 * 16);
    hmi_frame_begin();
    CHECK(hmi_ptr_pressed() && hmi_ptr_down() && !hmi_ptr_released());
    CHECK_EQ(hmi_ptr_x(), 50);
    hmi_ptr_consume();
    CHECK(!hmi_ptr_pressed() && hmi_ptr_consumed());
    frame(NULL);
    hmi_frame_begin();
    CHECK(!hmi_ptr_pressed() && !hmi_ptr_down() && hmi_ptr_released() && !hmi_ptr_consumed());
    frame(NULL);

    /* Moves merge; a move after them is applied in the next frame. */
    hmi_input_pointer(HMI_PTR_MOVE, 1 * 16, 1 * 16);
    hmi_input_pointer(HMI_PTR_MOVE, 7 * 16, 9 * 16);
    hmi_frame_begin();
    CHECK_EQ(hmi_ptr_x(), 7);
    CHECK_EQ(hmi_ptr_y(), 9);
    frame(NULL);

    /* A full queue drops events instead of overwriting. */
    for (int i = 0; i < 100; i++) hmi_input_pointer(i % 2 ? HMI_PTR_UP : HMI_PTR_DOWN, i * 16, 0);
    int presses = 0;
    for (int i = 0; i < 100; i++) {
        hmi_frame_begin();
        presses += hmi_ptr_pressed();
        frame(NULL);
    }
    CHECK_EQ(presses, 16);
    hmi_input_pointer(99, 0, 0); /* unknown kind: ignored */

    /* Arbitration from the previous frame's bounds. */
    hmi_core_init(400, 300);
    hmi_frame_begin();
    hmi_elem_bounds_in(1, 100, 100, 10, 10, 1);  /* small: touch area 28 x 28 */
    hmi_elem_bounds_in(2, 118, 100, 10, 10, 1);  /* neighbour, areas overlap */
    hmi_elem_bounds_in(3, 200, 100, 50, 50, 1);  /* large */
    hmi_elem_bounds_in(4, 210, 110, 10, 10, 1);  /* drawn on top of 3 */
    hmi_elem_bounds_in(5, 300, 100, 50, 50, 0);  /* takes no input */
    frame(NULL);
    struct {
        int32_t x, y, owner;
    } cases[] = {{105, 105, 1}, {112, 105, 1}, {115, 105, 2}, {120, 105, 2}, {96, 96, 1}, {80, 80, 0},
                 {215, 115, 4}, {230, 140, 3}, {320, 120, 0}, {108, 112, 1}};
    for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
        hmi_input_pointer(HMI_PTR_MOVE, cases[i].x * 16, cases[i].y * 16);
        hmi_frame_begin();
        CHECK_EQ(hmi_ptr_owner(), cases[i].owner);
        hmi_elem_bounds_in(1, 100, 100, 10, 10, 1);
        hmi_elem_bounds_in(2, 118, 100, 10, 10, 1);
        hmi_elem_bounds_in(3, 200, 100, 50, 50, 1);
        hmi_elem_bounds_in(4, 210, 110, 10, 10, 1);
        hmi_elem_bounds_in(5, 300, 100, 50, 50, 0);
        frame(NULL);
    }
}

/* ---- keys, keyboard, pages ---- */

static void test_keys_and_pages(void) {
    hmi_core_init(100, 100);
    CHECK_EQ(hmi_key_next(), 0);
    hmi_input_key('a');
    hmi_input_key(HMI_KEY_ENTER);
    CHECK_EQ(hmi_key_next(), 'a');
    CHECK_EQ(hmi_key_next(), HMI_KEY_ENTER);
    CHECK_EQ(hmi_key_next(), 0);
    for (int i = 0; i < 100; i++) hmi_input_key((uint32_t)('0' + i % 10));
    int n = 0;
    while (hmi_key_next()) n++;
    CHECK_EQ(n, 63);

    hmi_kbd_open(42, "12.5", -1, "Setpoint", -1, 1);
    CHECK(hmi_kbd_is_open() && hmi_kbd_numeric());
    CHECK_EQ(hmi_kbd_owner(), 42);
    CHECK(strcmp(hmi_kbd_text(), "12.5") == 0 && strcmp(hmi_kbd_title(), "Setpoint") == 0);
    hmi_kbd_set_text("13", 2);
    CHECK_EQ(hmi_kbd_take(42), 0);
    hmi_kbd_close(1);
    CHECK_EQ(hmi_kbd_owner(), 42);
    CHECK_EQ(hmi_kbd_take(7), 0);
    CHECK_EQ(hmi_kbd_take(42), 1);
    CHECK_EQ(hmi_kbd_take(42), 0);
    CHECK_EQ(hmi_kbd_owner(), 0);
    CHECK(strcmp(hmi_kbd_text(), "13") == 0);
    hmi_kbd_open(1, NULL, 3, NULL, -1, 0);
    CHECK(strcmp(hmi_kbd_text(), "") == 0);
    hmi_kbd_close(0);
    CHECK_EQ(hmi_kbd_take(1), 0);
    char big[400];
    for (int i = 0; i < 200; i++) {
        big[2 * i] = (char)0xC3;
        big[2 * i + 1] = (char)0xA9;
    }
    hmi_kbd_set_text(big, 400);
    CHECK_EQ(strlen(hmi_kbd_text()), 254);
    hmi_kbd_set_text("abcdef", -1);
    hmi_kbd_set_text(hmi_kbd_text(), 3); /* the source is the destination */
    CHECK(strcmp(hmi_kbd_text(), "abc") == 0);

    CHECK_EQ(hmi_page(), 0);
    CHECK_EQ(hmi_page_back(), 0);
    for (int32_t pg = 1; pg <= 10; pg++) hmi_set_page(pg);
    hmi_set_page(10); /* same page: no history entry */
    int backs = 0;
    while (hmi_page_back()) backs++;
    CHECK_EQ(backs, 8);
    CHECK_EQ(hmi_page(), 2);
}

/* ---- themes and colors ---- */

static void test_themes(void) {
    hmi_core_init(10, 10);
    hmi_theme_use(2);
    CHECK_EQ(hmi_theme_current(), 2);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_BACKGROUND, 2), 0xFF14161Au);
    CHECK_EQ(hmi_color_resolve(0x00ABCDEF, 2), 0xFFABCDEFu);
    CHECK_EQ(hmi_color_resolve(hmi_alpha(0x00ABCDEF, 50), 2), 0x7FABCDEFu);
    CHECK_EQ(hmi_color_resolve(hmi_alpha(0x00ABCDEF, 0), 2), 0x00ABCDEFu);
    CHECK_EQ(hmi_color_resolve(hmi_alpha(0x00ABCDEF, 140), 2), 0xFFABCDEFu);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | 0, 0), 0xFF000000u);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | 200, 0), 0xFF000000u);
    /* Undefined project theme resolves like theme 0; a defined one starts from its base. */
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_ACCENT, 9), hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_ACCENT, 0));
    hmi_theme_define(9, HMI_TOKEN_ACCENT, 0x123456);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_ACCENT, 9), 0xFF123456u);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_TEXT, 9), hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_TEXT, 0));
    hmi_theme_copy(10, 4);
    hmi_theme_define(10, HMI_TOKEN_DANGER, 0xFFFFFFFF);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_DANGER, 10), 0xFFFFFFFFu);
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_SURFACE, 10), hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_SURFACE, 4));
    hmi_theme_define(2, HMI_TOKEN_ACCENT, 0); /* predefined themes are read-only */
    CHECK_EQ(hmi_color_resolve(HMI_COLOR_TOKEN | HMI_TOKEN_ACCENT, 2), 0xFFFFAA28u);
    hmi_theme_use(99);
    CHECK_EQ(hmi_theme_current(), 0);
}

/* ---- sessions ---- */

static void test_sessions(void) {
    hmi_session_t *a = hmi_session_create(), *b = hmi_session_create();
    CHECK(a && b);
    CHECK(hmi_session_size() >= HMI_DL_CAPACITY);
    hmi_session_use(a);
    hmi_core_init(100, 50);
    hmi_set_page(3);
    hmi_theme_use(1);
    hmi_session_use(b);
    hmi_core_init(200, 80);
    CHECK_EQ(hmi_page(), 0);
    CHECK_EQ(hmi_theme_current(), 0);
    CHECK_EQ(hmi_screen_w(), 200);
    hmi_frame_begin();
    hmi_clear(0);
    size_t lb;
    const uint8_t *dlb = hmi_frame_end(&lb);
    hmi_session_use(a);
    CHECK_EQ(hmi_page(), 3);
    CHECK_EQ(hmi_screen_h(), 50);
    hmi_frame_begin();
    size_t la;
    const uint8_t *dla = hmi_frame_end(&la);
    CHECK(dla != dlb && la != lb);
    hmi_session_destroy(a); /* the session in use: falls back to the default one */
    CHECK_EQ(hmi_page(), 2);  /* default session state from test_keys_and_pages */
    hmi_session_destroy(b);
    hmi_session_destroy(NULL);
    hmi_session_use(NULL);
}

/* ---- text metrics and font fallback ---- */

static void test_text(void) {
    int have_regular = hmi_font_table[HMI_FONT_REGULAR] != NULL, have_bold = hmi_font_table[HMI_FONT_BOLD] != NULL;
    int32_t w_reg = hmi_text_width("Hello", -1, 20, HMI_FONT_REGULAR);
    int32_t w_bold = hmi_text_width("Hello", -1, 20, HMI_FONT_BOLD);
    CHECK_EQ(hmi_text_width("", -1, 20, HMI_FONT_REGULAR), 0);
    CHECK_EQ(hmi_text_width("Hello", -1, 0, HMI_FONT_REGULAR), 0);
    CHECK_EQ(hmi_text_width(NULL, 3, 20, HMI_FONT_REGULAR), 0);
    CHECK_EQ(hmi_text_width("Hello", -1, 20, 77), w_reg); /* unknown face: regular */
    if (have_regular) {
        int32_t upem;
        int32_t units = hmi_text_units(HMI_FONT_REGULAR, "Hello", 5, &upem);
        CHECK(upem > 0 && units > 0);
        CHECK_EQ(w_reg, ((int64_t)units * 320 + upem / 2) / upem / 16 + (((int64_t)units * 320 + upem / 2) / upem % 16 != 0));
        CHECK(w_reg > 40 && w_reg < 60);
        /* Kerning: "AV" is narrower than "A" + "V". */
        CHECK(hmi_font_text_width_q4(HMI_FONT_REGULAR, "AV", 2, 320) <
              hmi_font_text_width_q4(HMI_FONT_REGULAR, "A", 1, 320) + hmi_font_text_width_q4(HMI_FONT_REGULAR, "V", 1, 320));
        CHECK(hmi_font_line_height_q4(HMI_FONT_REGULAR, 320) > 320);
    }
    if (have_bold && have_regular) CHECK(w_bold > w_reg);
    /* Widths saturate instead of overflowing. */
    if (have_regular) {
        CHECK_EQ(hmi_text_width("WW", -1, 1 << 27, HMI_FONT_REGULAR), 134217728);
        CHECK_EQ(hmi_font_text_width_q4(HMI_FONT_REGULAR, "WW", 2, INT32_MAX), INT32_MAX);
        int n = 2000000;
        char *many = (char *)malloc((size_t)n);
        memset(many, 'W', (size_t)n);
        CHECK_EQ(hmi_text_width(many, n, 1000, HMI_FONT_REGULAR), 134217728);
        free(many);
    }
    if (!have_bold && have_regular) CHECK_EQ(w_bold, w_reg); /* missing face falls back */
    if (!have_regular && !have_bold) {
        CHECK_EQ(w_reg, 0);
        CHECK_EQ(hmi_font_line_height_q4(HMI_FONT_REGULAR, 320), 320);
        /* Text renders nothing, without failing. */
        hmi_core_init(50, 20);
        hmi_frame_begin();
        hmi_clear(0xFFFFFF);
        hmi_text(0, 0, "abc", -1, 12, HMI_FONT_BOLD, HMI_ALIGN_CENTER, 0);
        size_t len;
        const uint8_t *dl = hmi_frame_end(&len);
        uint8_t px[50 * 20 * 4];
        CHECK_EQ(hmi_raster_render(dl, len, px, 50, 20, 50, 0, 20, 256, 0, 0), HMI_RASTER_OK);
        int all_white = 1;
        for (size_t i = 0; i < sizeof px; i++) all_white &= px[i] == 255;
        CHECK(all_white);
    }
    /* UTF-8 helpers. */
    const unsigned char s[] = {'a', 0xC3, 0xA9, 0xE2, 0x82, 0xAC, 0xF0, 0x9F, 0x98, 0x80, 0xC3, 0xFF, 0xED, 0xA0, 0x80};
    int i = 0, n = (int)sizeof s;
    CHECK_EQ(hmi_utf8_next(s, n, &i), 'a');
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0xE9);
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0x20AC);
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0x1F600);
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0xC3); /* truncated sequence */
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0xFF);
    CHECK_EQ(hmi_utf8_next(s, n, &i), 0xED); /* surrogate encoded in UTF-8 is invalid */
    CHECK_EQ(i, 13);
    CHECK_EQ(hmi_utf8_clip("abc\xC3\xA9", 5, 4), 3);
    CHECK_EQ(hmi_utf8_clip("abc\xC3\xA9", 5, 5), 5);
    CHECK_EQ(hmi_utf8_clip("abc", 3, 0), 0);
}

/* ---- text under memory pressure and at extreme scales ---- */

extern int hmi_test_alloc_fail;
void hmi_test_glyph_cache_clear(void);

/* Renders one line of text at size lu and 2x density into px (200 x 80 px). */
static void render_text_line(int32_t size, uint8_t *px) {
    hmi_core_init(100, 40);
    hmi_frame_begin();
    hmi_clear(0xFFFFFF);
    hmi_text(2, 0, "Hag", -1, size, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x000000);
    size_t len;
    const uint8_t *dl = hmi_frame_end(&len);
    CHECK_EQ(hmi_raster_render(dl, len, px, 200, 80, 200, 0, 80, 512, 0, 0), HMI_RASTER_OK);
}

static int all_white(const uint8_t *px, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (px[i] != 255) return 0;
    return 1;
}

static void test_text_failures(void) {
    if (hmi_font_table[HMI_FONT_REGULAR] == NULL && hmi_font_table[HMI_FONT_BOLD] == NULL) return;
    static uint8_t ref[200 * 80 * 4], px[200 * 80 * 4];
    /* 12 lu glyphs go through the glyph cache; 36 lu glyphs (wider than 64 px at 2x, about 140 px tall) through the
     * scratch buffer and stb_truetype's heap scanline. */
    static const int32_t k_sizes[] = {12, 36};
    for (size_t i = 0; i < 2; i++) {
        render_text_line(k_sizes[i], ref);
        CHECK(!all_white(ref, sizeof ref));
        hmi_test_glyph_cache_clear();
        hmi_test_alloc_fail = 1;
        render_text_line(k_sizes[i], px);
        hmi_test_alloc_fail = 0;
        CHECK(all_white(px, sizeof px)); /* nothing drawn when the glyph could not be rasterized */
        render_text_line(k_sizes[i], px);
        CHECK(memcmp(px, ref, sizeof px) == 0); /* and nothing incomplete was cached */
    }
    /* A face too large to draw is skipped before stb converts its boxes to int (no overflow). */
    hmi_core_init(100, 40);
    hmi_frame_begin();
    hmi_text(0, -121503744, "W", -1, 134217727, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0);
    size_t len;
    const uint8_t *dl = hmi_frame_end(&len);
    uint8_t *big = (uint8_t *)calloc(64 * 64 * 4, 1);
    CHECK_EQ(hmi_raster_render(dl, len, big, 64, 64, 64, 0, 64, 32768, 0, 0), HMI_RASTER_OK);
    int untouched = 1;
    for (size_t i = 0; i < 64 * 64 * 4; i++) untouched &= big[i] == 0;
    CHECK(untouched);
    free(big);
}

/* ---- rasterizer: arguments, malformed lists, hashes, deadlines ---- */

static size_t sample_list(uint8_t *out, size_t cap) {
    hmi_core_init(64, 64);
    hmi_frame_begin();
    hmi_clear(0x101010);
    hmi_fill_rect(2, 2, 20, 10, 3, 0xFF0000);
    hmi_clip(0, 0, 40, 40);
    hmi_arc(30, 30, 12, 3, 10, 200, 0x00FF00);
    hmi_unclip();
    hmi_line(0, 60, 60, 40, 2, 0x0000FF);
    hmi_text(2, 40, "Ok", -1, 12, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0xFFFFFF);
    hmi_ellipse(48, 12, 10, 6, 0xFFFF00);
    size_t len;
    const uint8_t *dl = hmi_frame_end(&len);
    CHECK(len <= cap);
    memcpy(out, dl, len);
    return len;
}

static uint32_t g_clock;
static uint32_t clock_step(void) { return g_clock++; }
static uint32_t clock_late(void) { return 1000; }

static void test_raster(void) {
    uint8_t dl[1024];
    size_t len = sample_list(dl, sizeof dl);
    static uint8_t px[64 * 64 * 4], ref[64 * 64 * 4];
    CHECK_EQ(hmi_raster_render(dl, len, ref, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_OK);

    /* Arguments. */
    CHECK_EQ(hmi_raster_render(dl, len, NULL, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, len, px, 64, 64, 63, 0, 64, 256, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, len, px, 64, 64, 64, 1, 64, 256, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, len, px, 64, 64, 64, -1, 4, 256, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, len, px, 64, 64, 64, 0, 64, 0, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, len, px, 40000, 1, 40000, 0, 1, 256, 0, 0), HMI_RASTER_BAD_ARGS);
    CHECK_EQ(hmi_raster_render(dl, 19, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_BAD_LIST);
    CHECK_EQ(hmi_raster_render(NULL, len, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_BAD_LIST);

    /* Every truncation is reported, never read past. */
    for (size_t cut = HMI_DL_HEADER_SIZE; cut < len; cut++) {
        uint8_t *copy = (uint8_t *)malloc(cut);
        memcpy(copy, dl, cut);
        CHECK_EQ(hmi_raster_render(copy, cut, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_MALFORMED);
        uint32_t hashes[4];
        CHECK_EQ(hmi_raster_band_hashes(copy, cut, 64, 64, 16, 256, 0, 0, hashes, 4), HMI_RASTER_MALFORMED);
        free(copy);
    }
    /* Unknown opcode and bad polygon sizes. */
    uint8_t bad[sizeof dl];
    memcpy(bad, dl, len);
    bad[HMI_DL_HEADER_SIZE] = 99;
    CHECK_EQ(hmi_raster_render(bad, len, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_MALFORMED);
    uint8_t poly[HMI_DL_HEADER_SIZE + 1 + 6 + 2 * 8];
    memcpy(poly, dl, HMI_DL_HEADER_SIZE);
    hmi_wr_u32(poly + 16, 1);
    poly[HMI_DL_HEADER_SIZE] = HMI_OP_POLY;
    memset(poly + HMI_DL_HEADER_SIZE + 1, 0, sizeof poly - HMI_DL_HEADER_SIZE - 1);
    poly[HMI_DL_HEADER_SIZE + 1 + 4] = 2;
    CHECK_EQ(hmi_raster_render(poly, sizeof poly, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_MALFORMED);
    memcpy(bad, dl, len);
    bad[4] = 2; /* other version */
    CHECK_EQ(hmi_raster_render(bad, len, px, 64, 64, 64, 0, 64, 256, 0, 0), HMI_RASTER_BAD_LIST);

    /* Band hashes: same list, same hashes; a change at the bottom changes only the bottom bands. */
    uint32_t h1[8], h2[8];
    CHECK_EQ(hmi_raster_band_hashes(dl, len, 64, 64, 8, 256, 0, 0, h1, 8), HMI_RASTER_OK);
    CHECK_EQ(hmi_raster_band_hashes(dl, len, 64, 64, 8, 256, 0, 0, h2, 8), HMI_RASTER_OK);
    CHECK(memcmp(h1, h2, sizeof h1) == 0);
    hmi_core_init(64, 64);
    hmi_frame_begin();
    hmi_fill_rect(0, 0, 64, 20, 0, 0x111111);
    hmi_fill_rect(0, 50, 64, 10, 0, 0x222222);
    size_t l3;
    const uint8_t *d3 = hmi_frame_end(&l3);
    uint8_t c3[256];
    memcpy(c3, d3, l3);
    uint32_t a[8], b[8];
    hmi_raster_band_hashes(c3, l3, 64, 64, 8, 256, 0, 0, a, 8);
    hmi_frame_begin();
    hmi_fill_rect(0, 0, 64, 20, 0, 0x111111);
    hmi_fill_rect(0, 50, 64, 10, 0, 0x333333);
    d3 = hmi_frame_end(&l3);
    hmi_raster_band_hashes(d3, l3, 64, 64, 8, 256, 0, 0, b, 8);
    CHECK(a[0] == b[0] && a[1] == b[1] && a[2] == b[2] && a[3] == b[3] && a[4] == b[4]);
    CHECK(a[6] != b[6] && a[7] != b[7]);
    /* Scale changes every band. */
    hmi_raster_band_hashes(d3, l3, 64, 64, 8, 512, 0, 0, a, 8);
    for (int i = 0; i < 8; i++) CHECK(a[i] != b[i]);

    /* Deadlines: a clock already past aborts at once; an aborted band can be rendered again from scratch. */
    memset(px, 0, sizeof px);
    CHECK_EQ(hmi_raster_render_until(dl, len, px, 64, 64, 64, 0, 64, 256, 0, 0, clock_late, 10), HMI_RASTER_ABORTED);
    int aborted = 0;
    for (uint32_t limit = 1; limit < 400; limit += 7) {
        g_clock = 0;
        memset(px, 0, sizeof px);
        int rc = hmi_raster_render_until(dl, len, px, 64, 64, 64, 0, 64, 256, 0, 0, clock_step, limit);
        CHECK(rc == HMI_RASTER_OK || rc == HMI_RASTER_ABORTED);
        aborted += rc == HMI_RASTER_ABORTED;
        if (rc == HMI_RASTER_OK) CHECK(memcmp(px, ref, sizeof px) == 0);
    }
    CHECK(aborted > 0);
    CHECK_EQ(hmi_raster_render_until(dl, len, px, 64, 64, 64, 0, 64, 256, 0, 0, NULL, 0), HMI_RASTER_OK);
    CHECK(memcmp(px, ref, sizeof px) == 0);
    /* Wrap-around: the deadline lies after the clock wraps. */
    g_clock = 0xFFFFFFF0u;
    CHECK_EQ(hmi_raster_render_until(dl, len, px, 64, 64, 64, 0, 64, 256, 0, 0, clock_step, 0xFFFFFFFFu + 100000u),
             HMI_RASTER_OK);
}

int main(void) {
    test_trig();
    test_format_int();
    test_format_real();
    test_display_list();
    test_arc_wire();
    test_frames();
    test_pointer();
    test_keys_and_pages();
    test_themes();
    test_sessions();
    test_text();
    test_text_failures();
    test_raster();
    printf("unit: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures != 0;
}
