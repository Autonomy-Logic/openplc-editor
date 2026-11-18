/* HMI core: sessions, display list recording, frame transform, input and per-viewer state. */
#include <stdlib.h>
#include <string.h>

#include "hmi_internal.h"

#define PTR_QUEUE 32
#define KEY_QUEUE 64
#define PAGE_HISTORY 8
#define Q16_ONE 65536
#define MIN_TOUCH_Q4 (HMI_MIN_TOUCH_LU * 16)

typedef struct {
    uint8_t kind;
    int32_t x, y; /* Q4 screen */
} ptr_evt_t;

struct hmi_session {
    uint8_t dl[HMI_DL_CAPACITY];
    size_t len;
    uint32_t cmds;
    uint32_t status;
    int32_t w_lu, h_lu;
    uint32_t time_ms;

    ptr_evt_t pq[PTR_QUEUE];
    int pq_head, pq_tail;
    uint32_t kq[KEY_QUEUE];
    int kq_head, kq_tail;
    int has_ptr;
    int32_t px, py; /* Q4 screen */
    int down, pressed, released, consumed;
    int32_t ptr_owner;

    int32_t bounds[HMI_BOUNDS_MAX * 5];
    uint8_t bounds_input[HMI_BOUNDS_MAX];
    /* Frame clip each entry was recorded under: 0 = none, else 1 + index into bounds_clips. */
    uint8_t bounds_clip[HMI_BOUNDS_MAX];
    int32_t bounds_clips[HMI_BOUNDS_CLIPS_MAX][4];
    int bounds_n, bounds_clips_n;

    int32_t poly[HMI_POLY_MAX][2]; /* Q4 local */
    int poly_n;
    uint32_t poly_color;

    char kbd_text[HMI_KBD_TEXT_MAX];
    char kbd_title[HMI_KBD_TITLE_MAX];
    int32_t kbd_owner;
    int kbd_open, kbd_done, kbd_numeric;

    int32_t page;
    int32_t page_hist[PAGE_HISTORY];
    int page_hist_n;
    int32_t page_shown_1; /* page last shown + 1; 0 = none yet */
    int page_chosen;      /* hmi_page_reset ran */
    int sign_out;         /* screen code asked to sign the viewer out this frame */
    int32_t theme;

    /* Panel PIN: empty = none. While locked the host draws the PIN entry instead of the screens. */
    char pin[HMI_PIN_MAX + 1];
    char pin_entry[HMI_PIN_MAX + 1];
    uint32_t relock_ms, last_touch_ms;
    int locked, pin_wrong, pin_key; /* pin_key: key pressed, 1 + index, 0 = none */

    /* Touch calibration: samples of the press on the current target, the targets' points, the finished map. */
    int cal_enabled, cal_active, cal_failed, cal_done, cal_target, cal_down, cal_n;
    int32_t cal_sx[HMI_CAL_SAMPLES], cal_sy[HMI_CAL_SAMPLES];
    int32_t cal_raw[HMI_CAL_TARGETS * 2];
    int32_t cal_pts[HMI_CAL_TARGETS * 2];
    int cal_ok;

    /* Frame: screen_q4 = local_q4 * fk / 65536 + (fox, foy), clipped to (fcx, fcy, fcw, fch) when fclip. */
    int32_t fk, fox, foy, fcx, fcy, fcw, fch;
    int fclip, design;
};

static hmi_session_t g_default; /* zeroed (.bss); hmi_core_init sets its frame scale */
static hmi_session_t *S = &g_default;

/* ---- sessions ---- */

hmi_session_t *hmi_session_create(void) {
#ifdef HMI_STATIC_MEMORY
    return NULL;
#else
    hmi_session_t *s = (hmi_session_t *)calloc(1, sizeof(hmi_session_t));
    if (s) s->fk = Q16_ONE;
    return s;
#endif
}

void hmi_session_destroy(hmi_session_t *s) {
    if (!s || s == &g_default) return;
    if (S == s) S = &g_default;
#ifndef HMI_STATIC_MEMORY
    free(s);
#endif
}

void hmi_session_use(hmi_session_t *s) { S = s ? s : &g_default; }

size_t hmi_session_size(void) { return sizeof(hmi_session_t); }

void hmi_core_init(int32_t width_lu, int32_t height_lu) {
    if (S->fk == 0) S->fk = Q16_ONE;
    S->w_lu = width_lu;
    S->h_lu = height_lu;
    S->pq_head = S->pq_tail = 0;
    S->kq_head = S->kq_tail = 0;
    S->has_ptr = 0;
    S->down = S->pressed = S->released = S->consumed = 0;
    S->ptr_owner = 0;
    S->bounds_n = 0;
    S->len = 0;
}

void hmi_set_screen_size(int32_t width_lu, int32_t height_lu) {
    S->w_lu = width_lu;
    S->h_lu = height_lu;
}

void hmi_set_time_ms(uint32_t ms) { S->time_ms = ms; }
uint32_t hmi_time_ms(void) { return S->time_ms; }
int32_t hmi_screen_w(void) { return S->w_lu; }
int32_t hmi_screen_h(void) { return S->h_lu; }

/* ---- coordinates ---- */

static int32_t sat32(int64_t v) { return (int32_t)(v > INT32_MAX ? INT32_MAX : v < INT32_MIN ? INT32_MIN : v); }

/* Floor division for a positive divisor. */
static int64_t floor_div(int64_t n, int64_t d) {
    int64_t q = n / d;
    return (n % d != 0 && n < 0) ? q - 1 : q;
}

/* Local Q4 -> screen Q4 length, rounded half up. Inputs saturate to 32 bits first, so the product fits 64 bits. */
static int32_t scale_q4(int64_t v_q4) { return sat32(floor_div((int64_t)sat32(v_q4) * S->fk + Q16_ONE / 2, Q16_ONE)); }
static int32_t tx_q4(int64_t x_q4) { return sat32((int64_t)scale_q4(x_q4) + S->fox); }
static int32_t ty_q4(int64_t y_q4) { return sat32((int64_t)scale_q4(y_q4) + S->foy); }
static int32_t tx(int32_t x_lu) { return tx_q4((int64_t)x_lu * 16); }
static int32_t ty(int32_t y_lu) { return ty_q4((int64_t)y_lu * 16); }
static int32_t ts(int32_t v_lu) { return scale_q4((int64_t)v_lu * 16); }

/* ---- display list ---- */

static void put_u8(uint8_t v) { S->dl[S->len++] = v; }
static void put_u16(uint16_t v) {
    S->dl[S->len++] = (uint8_t)v;
    S->dl[S->len++] = (uint8_t)(v >> 8);
}
static void put_u32(uint32_t v) {
    hmi_wr_u32(&S->dl[S->len], v);
    S->len += 4;
}
static void put_i32(int32_t v) { put_u32((uint32_t)v); }

/* Starts a command with `payload` bytes; once one command does not fit, the rest of the frame is dropped. */
static int begin_cmd(uint8_t op, size_t payload) {
    if ((S->status & HMI_STATUS_DL_FULL) || S->len + 1 + payload > HMI_DL_CAPACITY) {
        S->status |= HMI_STATUS_DL_FULL;
        return 0;
    }
    put_u8(op);
    S->cmds++;
    return 1;
}

static uint32_t color(uint32_t c) { return hmi_color_resolve(c, S->theme); }

void hmi_frame_begin(void) {
    S->len = 0;
    S->cmds = 0;
    S->status = 0;
    S->sign_out = 0;
    put_u32(HMI_DL_MAGIC);
    put_u16(HMI_DL_VERSION);
    put_u16(0);
    put_i32(S->w_lu);
    put_i32(S->h_lu);
    put_u32(0); /* command count, set by hmi_frame_end */

    S->pressed = S->released = S->consumed = 0;
    int prev_bounds = S->bounds_n;
    S->bounds_n = 0;
    S->bounds_clips_n = 0;
    hmi_frame_reset();

    /* At most one press or release per frame, so a quick tap is seen as both; moves apply in passing. */
    if (S->pq_head != S->pq_tail) S->last_touch_ms = S->time_ms;
    while (S->pq_head != S->pq_tail) {
        ptr_evt_t e = S->pq[S->pq_head];
        S->pq_head = (S->pq_head + 1) % PTR_QUEUE;
        S->has_ptr = 1;
        S->px = e.x;
        S->py = e.y;
        if (e.kind == HMI_PTR_DOWN) {
            S->down = 1;
            S->pressed = 1;
            break;
        }
        if (e.kind == HMI_PTR_UP) {
            S->down = 0;
            S->released = 1;
            break;
        }
    }

    /* Owner from the previous frame's input elements: the last drawn that contains the pointer, else the nearest
     * whose touch area (at least MIN_TOUCH_Q4 square, centred) contains it. */
    S->ptr_owner = 0;
    if (!S->has_ptr) return;
    int64_t best = -1;
    int64_t px = S->px, py = S->py;
    for (int i = 0; i < prev_bounds; i++) {
        if (!S->bounds_input[i]) continue;
        if (S->bounds_clip[i]) {
            const int32_t *c = S->bounds_clips[S->bounds_clip[i] - 1];
            if (px < c[0] || py < c[1] || px >= (int64_t)c[0] + c[2] || py >= (int64_t)c[1] + c[3]) continue;
        }
        const int32_t *b = &S->bounds[i * 5];
        int64_t x0 = b[1], y0 = b[2], x1 = x0 + b[3], y1 = y0 + b[4];
        if (px >= x0 && px < x1 && py >= y0 && py < y1) {
            S->ptr_owner = b[0];
            best = 0;
            continue;
        }
        if (best == 0) continue;
        int64_t mx = b[3] < MIN_TOUCH_Q4 ? (MIN_TOUCH_Q4 - (int64_t)b[3]) / 2 : 0;
        int64_t my = b[4] < MIN_TOUCH_Q4 ? (MIN_TOUCH_Q4 - (int64_t)b[4]) / 2 : 0;
        if (px < x0 - mx || px >= x1 + mx || py < y0 - my || py >= y1 + my) continue;
        int64_t dx = px < x0 ? x0 - px : px >= x1 ? px - x1 + 1 : 0;
        int64_t dy = py < y0 ? y0 - py : py >= y1 ? py - y1 + 1 : 0;
        int64_t d = dx * dx + dy * dy;
        if (best < 0 || d < best) {
            best = d;
            S->ptr_owner = b[0];
        }
    }
}

const uint8_t *hmi_frame_end(size_t *len) {
    hmi_wr_u32(&S->dl[16], S->cmds);
    if (len) *len = S->len;
    return S->dl;
}

uint64_t hmi_frame_hash(void) {
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < S->len; i++) {
        h ^= S->dl[i];
        h *= 1099511628211ULL;
    }
    return h;
}

uint32_t hmi_frame_status(void) { return S->status; }

/* ---- themes (selection is per session) ---- */

void hmi_theme_use(int32_t theme) { S->theme = (theme >= 0 && theme < HMI_THEMES_MAX) ? theme : 0; }
int32_t hmi_theme_current(void) { return S->theme; }

/* ---- primitives ---- */

void hmi_clear(uint32_t c) {
    if (!begin_cmd(HMI_OP_CLEAR, HMI_PAYLOAD_CLEAR)) return;
    put_u32(color(c));
}

void hmi_fill_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t radius, uint32_t c) {
    if (!begin_cmd(HMI_OP_RECT, HMI_PAYLOAD_RECT)) return;
    put_i32(tx(x));
    put_i32(ty(y));
    put_i32(ts(w));
    put_i32(ts(h));
    put_i32(ts(radius));
    put_u32(color(c));
}

void hmi_stroke_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t radius, int32_t width, uint32_t c) {
    if (!begin_cmd(HMI_OP_RECT_STROKE, HMI_PAYLOAD_RECT_STROKE)) return;
    put_i32(tx(x));
    put_i32(ty(y));
    put_i32(ts(w));
    put_i32(ts(h));
    put_i32(ts(radius));
    put_i32(ts(width));
    put_u32(color(c));
}

/* One segment between two local Q4 points; c is already resolved. */
static void line_q4(int64_t x1, int64_t y1, int64_t x2, int64_t y2, int32_t width, uint32_t argb) {
    if (!begin_cmd(HMI_OP_LINE, HMI_PAYLOAD_LINE)) return;
    put_i32(tx_q4(x1));
    put_i32(ty_q4(y1));
    put_i32(tx_q4(x2));
    put_i32(ty_q4(y2));
    put_i32(ts(width));
    put_u32(argb);
}

void hmi_line(int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t width, uint32_t c) {
    line_q4((int64_t)x1 * 16, (int64_t)y1 * 16, (int64_t)x2 * 16, (int64_t)y2 * 16, width, color(c));
}

void hmi_fill_circle(int32_t cx, int32_t cy, int32_t r, uint32_t c) {
    if (!begin_cmd(HMI_OP_CIRCLE, HMI_PAYLOAD_CIRCLE)) return;
    put_i32(tx(cx));
    put_i32(ty(cy));
    put_i32(ts(r));
    put_u32(color(c));
}

void hmi_arc(int32_t cx, int32_t cy, int32_t r, int32_t width, int32_t a0_deg, int32_t a1_deg, uint32_t c) {
    /* Start normalised to [0, 360), sweep limited to one turn, so Q6 angles never overflow. */
    int64_t sweep = (int64_t)a1_deg - a0_deg;
    if (sweep > 360) sweep = 360;
    if (sweep < -360) sweep = -360;
    int64_t a0 = a0_deg % 360;
    if (a0 < 0) a0 += 360;
    if (!begin_cmd(HMI_OP_ARC, HMI_PAYLOAD_ARC)) return;
    put_i32(tx(cx));
    put_i32(ty(cy));
    put_i32(ts(r));
    put_i32(ts(width));
    put_i32((int32_t)(a0 * 64));
    put_i32((int32_t)((a0 + sweep) * 64));
    put_u32(color(c));
}

void hmi_stroke_circle(int32_t cx, int32_t cy, int32_t r, int32_t width, uint32_t c) {
    hmi_arc(cx, cy, r, width, 0, 360, c);
}

static int clamp_font(int font) { return font >= 0 && font < HMI_FONTS ? font : HMI_FONT_REGULAR; }
static int clamp_align(int a) { return a == HMI_ALIGN_CENTER || a == HMI_ALIGN_RIGHT ? a : HMI_ALIGN_LEFT; }

static int text_len(const char *s, int len) {
    if (!s) return 0;
    if (len < 0) len = (int)strlen(s);
    if (len > HMI_TEXT_MAX_BYTES) {
        S->status |= HMI_STATUS_TEXT_TRUNCATED;
        len = hmi_utf8_clip(s, len, HMI_TEXT_MAX_BYTES);
    }
    return len;
}

/* Text at a local Q4 anchor. */
static void text_q4(int64_t x_q4, int64_t y_q4, const char *s, int len, int32_t size, int font, int align,
                    uint32_t c) {
    if (size <= 0) return;
    len = text_len(s, len);
    if (!begin_cmd(HMI_OP_TEXT, HMI_PAYLOAD_TEXT_HEAD + (size_t)len)) return;
    put_i32(tx_q4(x_q4));
    put_i32(ty_q4(y_q4));
    put_i32(ts(size));
    put_u8((uint8_t)clamp_font(font));
    put_u8((uint8_t)clamp_align(align));
    put_u32(color(c));
    put_u16((uint16_t)len);
    if (len > 0) memcpy(&S->dl[S->len], s, (size_t)len);
    S->len += (size_t)len;
}

void hmi_text(int32_t x, int32_t y, const char *s, int len, int32_t size, int font, int align, uint32_t c) {
    text_q4((int64_t)x * 16, (int64_t)y * 16, s, len, size, font, align, c);
}

void hmi_text_box(int32_t x, int32_t y, int32_t w, int32_t h, const char *s, int len, int32_t size, int font,
                  int halign, int valign, uint32_t c) {
    if (size <= 0) return;
    halign = clamp_align(halign);
    int64_t ax = (int64_t)x * 16;
    if (halign == HMI_ALIGN_CENTER) ax += (int64_t)w * 8;
    if (halign == HMI_ALIGN_RIGHT) ax += (int64_t)w * 16;
    int64_t lh = hmi_font_line_height_q4(clamp_font(font), sat32((int64_t)size * 16));
    int64_t ay = (int64_t)y * 16;
    if (valign == HMI_VALIGN_MIDDLE) ay += floor_div((int64_t)h * 16 - lh, 2);
    if (valign == HMI_VALIGN_BOTTOM) ay += (int64_t)h * 16 - lh;
    text_q4(ax, ay, s, len, size, font, halign, c);
}

int32_t hmi_text_width(const char *s, int len, int32_t size, int font) {
    if (!s || size <= 0) return 0;
    if (len < 0) len = (int)strlen(s);
    int64_t w = hmi_font_text_width_q4(clamp_font(font), s, len, sat32((int64_t)size * 16));
    return sat32((w + 15) / 16);
}

/* Clip rectangle in screen Q4. */
static void emit_clip(int32_t x, int32_t y, int32_t w, int32_t h) {
    if (!begin_cmd(HMI_OP_CLIP, HMI_PAYLOAD_CLIP)) return;
    put_i32(x);
    put_i32(y);
    put_i32(w);
    put_i32(h);
}

void hmi_clip(int32_t x, int32_t y, int32_t w, int32_t h) {
    int64_t x0 = tx(x), y0 = ty(y);
    int64_t x1 = x0 + ts(w), y1 = y0 + ts(h);
    if (S->fclip) {
        if (x0 < S->fcx) x0 = S->fcx;
        if (y0 < S->fcy) y0 = S->fcy;
        if (x1 > (int64_t)S->fcx + S->fcw) x1 = (int64_t)S->fcx + S->fcw;
        if (y1 > (int64_t)S->fcy + S->fch) y1 = (int64_t)S->fcy + S->fch;
    }
    emit_clip((int32_t)x0, (int32_t)y0, x1 > x0 ? sat32(x1 - x0) : 0, y1 > y0 ? sat32(y1 - y0) : 0);
}

void hmi_unclip(void) {
    if (S->fclip) {
        emit_clip(S->fcx, S->fcy, S->fcw, S->fch);
        return;
    }
    begin_cmd(HMI_OP_UNCLIP, 0);
}

/* ---- polygons ---- */

void hmi_poly_begin(uint32_t c) {
    S->poly_n = 0;
    S->poly_color = color(c);
}

void hmi_poly_point(int32_t x, int32_t y) {
    if (S->poly_n >= HMI_POLY_MAX) {
        S->status |= HMI_STATUS_POLY_FULL;
        return;
    }
    S->poly[S->poly_n][0] = sat32((int64_t)x * 16);
    S->poly[S->poly_n][1] = sat32((int64_t)y * 16);
    S->poly_n++;
}

static void emit_poly(const int32_t (*pts)[2], int n, uint32_t argb) {
    if (n < 3) return;
    if (!begin_cmd(HMI_OP_POLY, HMI_PAYLOAD_POLY_HEAD + (size_t)n * 8u)) return;
    put_u32(argb);
    put_u16((uint16_t)n);
    for (int i = 0; i < n; i++) {
        put_i32(tx_q4(pts[i][0]));
        put_i32(ty_q4(pts[i][1]));
    }
}

void hmi_poly_end(void) { emit_poly((const int32_t (*)[2])S->poly, S->poly_n, S->poly_color); }

void hmi_poly_stroke(int32_t width, int closed) {
    int n = S->poly_n;
    if (n < 2) return;
    for (int i = 0; i + 1 < n; i++)
        line_q4(S->poly[i][0], S->poly[i][1], S->poly[i + 1][0], S->poly[i + 1][1], width, S->poly_color);
    if (closed && n > 2) line_q4(S->poly[n - 1][0], S->poly[n - 1][1], S->poly[0][0], S->poly[0][1], width, S->poly_color);
}

/* The 32 points of an ellipse in local Q4. */
static void ellipse_points(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t pts[32][2]) {
    for (int i = 0; i < 32; i++) {
        pts[i][0] = sat32((int64_t)cx * 16 + floor_div((int64_t)rx * 16 * hmi_circle32[i][0] + 8192, 16384));
        pts[i][1] = sat32((int64_t)cy * 16 + floor_div((int64_t)ry * 16 * hmi_circle32[i][1] + 8192, 16384));
    }
}

void hmi_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, uint32_t c) {
    int32_t pts[32][2];
    ellipse_points(cx, cy, rx, ry, pts);
    emit_poly((const int32_t (*)[2])pts, 32, color(c));
}

void hmi_stroke_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t width, uint32_t c) {
    int32_t pts[32][2];
    ellipse_points(cx, cy, rx, ry, pts);
    uint32_t argb = color(c);
    for (int i = 0; i < 32; i++) {
        int j = (i + 1) % 32;
        line_q4(pts[i][0], pts[i][1], pts[j][0], pts[j][1], width, argb);
    }
}

/* ---- frames ---- */

void hmi_frame_set(int32_t k_q16, int32_t ox_q4, int32_t oy_q4, int clip, int32_t cx_q4, int32_t cy_q4,
                   int32_t cw_q4, int32_t ch_q4) {
    S->fk = k_q16 > 0 ? k_q16 : Q16_ONE;
    S->fox = ox_q4;
    S->foy = oy_q4;
    S->fclip = clip != 0;
    S->fcx = cx_q4;
    S->fcy = cy_q4;
    S->fcw = cw_q4 > 0 ? cw_q4 : 0;
    S->fch = ch_q4 > 0 ? ch_q4 : 0;
}

void hmi_frame_reset(void) { hmi_frame_set(Q16_ONE, 0, 0, 0, 0, 0, 0, 0); }

void hmi_frame_clip(void) {
    if (S->fclip) emit_clip(S->fcx, S->fcy, S->fcw, S->fch);
}

void hmi_set_design_mode(int on) { S->design = on != 0; }
int hmi_design_mode(void) { return S->design; }

/* ---- pointer ---- */

static int ptr_away(void) {
    if (!S->has_ptr) return 1;
    if (!S->fclip) return 0;
    int64_t px = S->px, py = S->py;
    return px < S->fcx || py < S->fcy || px >= (int64_t)S->fcx + S->fcw || py >= (int64_t)S->fcy + S->fch;
}

/* Screen Q4 -> local lu through the frame, rounded toward minus infinity. */
static int32_t to_local(int32_t screen_q4, int32_t off_q4) {
    return sat32(floor_div(((int64_t)screen_q4 - off_q4) * Q16_ONE, (int64_t)(S->fk > 0 ? S->fk : Q16_ONE) * 16));
}

int32_t hmi_ptr_x(void) { return ptr_away() ? HMI_PTR_AWAY : to_local(S->px, S->fox); }
int32_t hmi_ptr_y(void) { return ptr_away() ? HMI_PTR_AWAY : to_local(S->py, S->foy); }
int hmi_ptr_down(void) { return S->down; }
int hmi_ptr_pressed(void) { return S->pressed && !S->consumed; }
int hmi_ptr_released(void) { return S->released; }
void hmi_ptr_consume(void) { S->consumed = 1; }
int hmi_ptr_consumed(void) { return S->consumed; }
int32_t hmi_ptr_owner(void) { return S->ptr_owner; }

void hmi_input_pointer(int kind, int32_t x_q4, int32_t y_q4) {
    if (kind != HMI_PTR_DOWN && kind != HMI_PTR_MOVE && kind != HMI_PTR_UP) return;
    if (kind == HMI_PTR_MOVE && S->pq_head != S->pq_tail) {
        int last = (S->pq_tail + PTR_QUEUE - 1) % PTR_QUEUE;
        if (S->pq[last].kind == HMI_PTR_MOVE) {
            S->pq[last].x = x_q4;
            S->pq[last].y = y_q4;
            return;
        }
    }
    int next = (S->pq_tail + 1) % PTR_QUEUE;
    if (next == S->pq_head) return;
    S->pq[S->pq_tail].kind = (uint8_t)kind;
    S->pq[S->pq_tail].x = x_q4;
    S->pq[S->pq_tail].y = y_q4;
    S->pq_tail = next;
}

/* ---- keys ---- */

void hmi_input_key(uint32_t code) {
    int next = (S->kq_tail + 1) % KEY_QUEUE;
    if (next == S->kq_head) return;
    S->kq[S->kq_tail] = code;
    S->kq_tail = next;
}

uint32_t hmi_key_next(void) {
    if (S->kq_head == S->kq_tail) return 0;
    uint32_t c = S->kq[S->kq_head];
    S->kq_head = (S->kq_head + 1) % KEY_QUEUE;
    return c;
}

/* ---- element bounds ---- */

void hmi_elem_bounds(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h) { hmi_elem_bounds_in(id, x, y, w, h, 0); }

void hmi_elem_bounds_in(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h, int takes_input) {
#ifdef HMI_STATIC_MEMORY
    if (!takes_input) return;
    const int64_t pad = MIN_TOUCH_Q4 / 2, sx = tx(x), sy = ty(y);
    if (sx - pad >= (int64_t)S->w_lu * 16 || sy - pad >= (int64_t)S->h_lu * 16 || sx + ts(w) + pad <= 0 ||
        sy + ts(h) + pad <= 0)
        return;
#endif
    if (S->bounds_n >= HMI_BOUNDS_MAX) {
        S->status |= HMI_STATUS_BOUNDS_FULL;
        return;
    }
    S->bounds_clip[S->bounds_n] = 0;
    if (S->fclip) {
        int k = 0;
        while (k < S->bounds_clips_n && !(S->bounds_clips[k][0] == S->fcx && S->bounds_clips[k][1] == S->fcy &&
                                          S->bounds_clips[k][2] == S->fcw && S->bounds_clips[k][3] == S->fch))
            k++;
        if (k == S->bounds_clips_n && k < HMI_BOUNDS_CLIPS_MAX) {
            S->bounds_clips[k][0] = S->fcx;
            S->bounds_clips[k][1] = S->fcy;
            S->bounds_clips[k][2] = S->fcw;
            S->bounds_clips[k][3] = S->fch;
            S->bounds_clips_n++;
        }
        if (k < S->bounds_clips_n) {
            S->bounds_clip[S->bounds_n] = (uint8_t)(k + 1);
        } else {
            S->status |= HMI_STATUS_BOUNDS_FULL;
            takes_input = 0;
#ifdef HMI_STATIC_MEMORY
            return;
#endif
        }
    }
    S->bounds_input[S->bounds_n] = (uint8_t)(takes_input != 0);
    int32_t *b = &S->bounds[S->bounds_n * 5];
    b[0] = id;
    b[1] = tx(x);
    b[2] = ty(y);
    b[3] = ts(w);
    b[4] = ts(h);
    S->bounds_n++;
}

int hmi_bounds_count(void) { return S->bounds_n; }
const int32_t *hmi_bounds_data(void) { return S->bounds; }

/* ---- on-screen keyboard ---- */

static void copy_text(char *dst, int cap, const char *src, int len) {
    if (!src) len = 0;
    else if (len < 0) len = (int)strlen(src);
    if (len > cap - 1) len = hmi_utf8_clip(src, len, cap - 1);
    if (len > 0) memmove(dst, src, (size_t)len); /* src may be dst: hmi_kbd_set_text(hmi_kbd_text(), n) */
    dst[len] = 0;
}

void hmi_kbd_open(int32_t owner, const char *text, int text_len, const char *title, int title_len, int numeric) {
    S->kbd_open = 1;
    S->kbd_done = 0;
    S->kbd_owner = owner;
    S->kbd_numeric = numeric != 0;
    copy_text(S->kbd_text, HMI_KBD_TEXT_MAX, text, text_len);
    copy_text(S->kbd_title, HMI_KBD_TITLE_MAX, title, title_len);
}

int hmi_kbd_is_open(void) { return S->kbd_open; }
int hmi_kbd_numeric(void) { return S->kbd_numeric; }
int32_t hmi_kbd_owner(void) { return S->kbd_open || S->kbd_done ? S->kbd_owner : 0; }
const char *hmi_kbd_text(void) { return S->kbd_text; }
const char *hmi_kbd_title(void) { return S->kbd_title; }
void hmi_kbd_set_text(const char *text, int len) { copy_text(S->kbd_text, HMI_KBD_TEXT_MAX, text, len); }

void hmi_kbd_close(int accepted) {
    S->kbd_open = 0;
    S->kbd_done = accepted != 0;
}

int hmi_kbd_take(int32_t owner) {
    if (!S->kbd_done || S->kbd_owner != owner) return 0;
    S->kbd_done = 0;
    return 1;
}

/* ---- pages ---- */

int32_t hmi_page(void) { return S->page; }

void hmi_set_page(int32_t page) {
    if (page == S->page) return;
    if (S->page_hist_n == PAGE_HISTORY) {
        memmove(S->page_hist, S->page_hist + 1, sizeof(S->page_hist[0]) * (PAGE_HISTORY - 1));
        S->page_hist_n = PAGE_HISTORY - 1;
    }
    S->page_hist[S->page_hist_n++] = S->page;
    S->page = page;
}

void hmi_page_reset(int32_t page) {
    S->page = page;
    S->page_hist_n = 0;
    S->page_chosen = 1;
}

int hmi_page_chosen(void) { return S->page_chosen; }

int32_t hmi_page_shown(void) { return S->page_shown_1 - 1; }
void hmi_page_set_shown(int32_t page) { S->page_shown_1 = page < 0 ? 0 : page + 1; }

int hmi_page_back(void) {
    if (S->page_hist_n == 0) return 0;
    S->page = S->page_hist[--S->page_hist_n];
    return 1;
}

void hmi_sign_out(void) { S->sign_out = 1; }
int hmi_frame_sign_out(void) { return S->sign_out; }

/* ---- panel lock ---- */

static void lock_now(void) {
    S->locked = 1;
    S->pin_entry[0] = 0;
    S->pin_wrong = 0;
    S->pin_key = 0;
}

void hmi_lock_setup(const char *pin, uint32_t relock_ms) {
    size_t n = 0;
    while (pin && pin[n] >= '0' && pin[n] <= '9' && n < HMI_PIN_MAX) n++;
    if (pin && pin[n] != 0) n = 0;
    memcpy(S->pin, pin ? pin : "", n);
    S->pin[n] = 0;
    S->relock_ms = relock_ms;
    S->last_touch_ms = S->time_ms;
    if (n > 0) lock_now();
    else S->locked = 0;
}

void hmi_lock(void) {
    if (S->pin[0]) lock_now();
}

int hmi_lock_active(void) {
    if (S->pin[0] && !S->locked && S->relock_ms > 0 && S->time_ms - S->last_touch_ms >= S->relock_ms) lock_now();
    return S->locked;
}

/* PIN entry layout in logical units: key i (0..11) is 1-9, clear, 0, OK. */
typedef struct {
    int32_t x, y, w, h;
} lock_rect_t;

static lock_rect_t lock_key_rect(int i) {
    const int32_t m = 8, gap = 6, top = 72;
    int32_t kh = (S->h_lu - top - m - 3 * gap) / 4;
    int32_t width = S->w_lu - 2 * m < 360 ? S->w_lu - 2 * m : 360;
    int32_t kw = (width - 2 * gap) / 3;
    int32_t x0 = (S->w_lu - (3 * kw + 2 * gap)) / 2;
    lock_rect_t r = {x0 + (i % 3) * (kw + gap), top + (i / 3) * (kh + gap), kw, kh};
    return r;
}

static int lock_key_at(int32_t x_q4, int32_t y_q4) {
    for (int i = 0; i < 12; i++) {
        lock_rect_t r = lock_key_rect(i);
        if (x_q4 >= (int64_t)r.x * 16 && x_q4 < (int64_t)(r.x + r.w) * 16 && y_q4 >= (int64_t)r.y * 16 &&
            y_q4 < (int64_t)(r.y + r.h) * 16)
            return i + 1;
    }
    return 0;
}

static void lock_key(int i) {
    size_t n = strlen(S->pin_entry);
    if (i == 9) {
        S->pin_entry[0] = 0;
        S->pin_wrong = 0;
    } else if (i == 11) {
        if (n > 0 && strcmp(S->pin_entry, S->pin) == 0) {
            S->locked = 0;
            S->last_touch_ms = S->time_ms;
        } else {
            S->pin_wrong = 1;
        }
        S->pin_entry[0] = 0;
    } else if (n < HMI_PIN_MAX) {
        S->pin_entry[n] = (char)(i == 10 ? '0' : '1' + i);
        S->pin_entry[n + 1] = 0;
        S->pin_wrong = 0;
    }
}

void hmi_lock_draw(void) {
    static const char *const labels[12] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "OK"};
    const uint32_t tok = HMI_COLOR_TOKEN;
    if (S->pressed) S->pin_key = S->has_ptr ? lock_key_at(S->px, S->py) : 0;
    if (S->released) {
        int key = S->has_ptr ? lock_key_at(S->px, S->py) : 0;
        if (key != 0 && key == S->pin_key) lock_key(key - 1);
        S->pin_key = 0;
    }
    hmi_clear(tok | HMI_TOKEN_BACKGROUND);
    if (!S->locked) return;
    hmi_text(S->w_lu / 2, 10, "Enter PIN", -1, 16, HMI_FONT_REGULAR, HMI_ALIGN_CENTER, tok | HMI_TOKEN_TEXT);
    lock_rect_t k0 = lock_key_rect(0), k2 = lock_key_rect(2);
    int32_t ex = k0.x, ew = k2.x + k2.w - k0.x;
    hmi_fill_rect(ex, 34, ew, 30, 6, tok | HMI_TOKEN_SURFACE);
    hmi_stroke_rect(ex, 34, ew, 30, 6, 1, tok | HMI_TOKEN_BORDER);
    if (S->pin_wrong) {
        hmi_text_box(ex, 34, ew, 30, "Wrong PIN", -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_CENTER, HMI_VALIGN_MIDDLE,
                     tok | HMI_TOKEN_DANGER);
    } else {
        char stars[HMI_PIN_MAX + 1];
        size_t n = strlen(S->pin_entry);
        memset(stars, '*', n);
        stars[n] = 0;
        hmi_text_box(ex, 34, ew, 30, stars, (int)n, 20, HMI_FONT_REGULAR, HMI_ALIGN_CENTER, HMI_VALIGN_MIDDLE,
                     tok | HMI_TOKEN_TEXT);
    }
    for (int i = 0; i < 12; i++) {
        lock_rect_t r = lock_key_rect(i);
        int ok = i == 11, held = S->down && S->pin_key == i + 1;
        uint32_t fill = tok | (ok ? HMI_TOKEN_ACCENT : held ? HMI_TOKEN_FILL : HMI_TOKEN_SURFACE);
        hmi_fill_rect(r.x, r.y, r.w, r.h, 6, held && ok ? hmi_alpha(fill, 80) : fill);
        if (!ok) hmi_stroke_rect(r.x, r.y, r.w, r.h, 6, 1, tok | HMI_TOKEN_BORDER);
        int32_t size = r.h * 45 / 100 < 20 ? r.h * 45 / 100 : 20;
        hmi_text_box(r.x, r.y, r.w, r.h, labels[i], -1, i == 9 ? size * 3 / 4 : size, HMI_FONT_REGULAR,
                     HMI_ALIGN_CENTER, HMI_VALIGN_MIDDLE, tok | (ok ? HMI_TOKEN_ON_ACCENT : HMI_TOKEN_TEXT));
    }
}

/* ---- startup screen ---- */

#define SPLASH_BACKGROUND 0xFFFFFFu
#define SPLASH_MARK 0x0066FCu
#define SPLASH_NAME 0x000000u
#define SPLASH_HINT 0x5B6472u
/** Size of the drawing the mark's points are given in. */
#define SPLASH_MARK_W 671
#define SPLASH_MARK_H 448
#define SPLASH_MARK_POINTS 18
/** Box of the wordmark's letters in its drawing's units: left, top, width and cap height. */
#define SPLASH_NAME_X 6
#define SPLASH_NAME_Y 7
#define SPLASH_NAME_W 1194
#define SPLASH_NAME_H 215

/** Outline of the mark's left chevron, in its drawing's units; the right one is its mirror image. */
static const int16_t splash_chevron[SPLASH_MARK_POINTS * 2] = {
    224, 1,   272, 49,  141, 180, 136, 185, 130, 190, 121, 195, 113, 198, 105, 200, 63,  200,
    63,  248, 105, 248, 114, 250, 126, 255, 133, 260, 140, 267, 272, 399, 224, 447, 1,   224,
};

/**
 * Shapes of the wordmark AUTONOMY, letter by letter, in its drawing's units: per shape a kind (0 polygon, 1 rounded
 * rectangle), a colour (0 ink, 1 background, which cuts counters) and then the points (count first) or x, y, w, h and
 * radius.
 */
static const int16_t splash_name[] = {
    0, 0, 4,  53,   7,    79,   7,    127,  222,  6,    222,
    0, 1, 3,  66,   65,   83,   148,  49,   148,
    0, 1, 4,  44,   176,  88,   176,  97,   223,  35,   223,
    1, 0, 168, 7,   100,  217,  50,
    1, 0, 168, 7,   100,  60,   0,
    1, 1, 198, -1,  39,   195,  19,
    1, 1, 198, -1,  39,   60,   0,
    1, 0, 305, 7,   103,  30,   0,
    1, 0, 341, 7,   31,   215,  0,
    1, 0, 440, 5,   103,  220,  51,
    1, 1, 471, 36,  41,   158,  20,
    1, 0, 594, 7,   31,   215,  0,
    1, 0, 671, 7,   31,   215,  0,
    0, 0, 4,  593,  7,    622,  7,    703,  222,  674,  222,
    1, 0, 752, 5,   103,  220,  51,
    1, 1, 783, 36,  41,   158,  20,
    1, 0, 908, 7,   30,   215,  0,
    1, 0, 1016, 7,  31,   215,  0,
    0, 0, 7,  909,  7,    938,  7,    977,  121,  1016, 7,    1046, 7,    983,  184,  969,  184,
    0, 0, 9,  1086, 7,    1118, 7,    1143, 88,   1168, 7,    1200, 7,    1158, 135,  1158, 222,
    1128, 222, 1128, 135,
};

/** One chevron of the mark, scaled by num / den with its drawing's top left at (x0, y0), mirrored when mirror != 0. */
static void splash_chevron_draw(int32_t x0, int32_t y0, int32_t num, int32_t den, int mirror) {
    hmi_poly_begin(SPLASH_MARK);
    for (int i = 0; i < SPLASH_MARK_POINTS; i++) {
        int32_t px = splash_chevron[i * 2], py = splash_chevron[i * 2 + 1];
        if (mirror) px = SPLASH_MARK_W - px;
        hmi_poly_point(x0 + px * num / den, y0 + py * num / den);
    }
    hmi_poly_end();
}

/** The wordmark with its cap height scaled to cap and its letters' top left at (x0, y0). */
static void splash_name_draw(int32_t x0, int32_t y0, int32_t cap) {
#define SX(u) (x0 + ((int32_t)(u) - SPLASH_NAME_X) * cap / SPLASH_NAME_H)
#define SY(v) (y0 + ((int32_t)(v) - SPLASH_NAME_Y) * cap / SPLASH_NAME_H)
    size_t i = 0;
    while (i < sizeof splash_name / sizeof splash_name[0]) {
        const int16_t *v = &splash_name[i];
        const uint32_t color = v[1] ? SPLASH_BACKGROUND : SPLASH_NAME;
        if (v[0] == 0) {
            hmi_poly_begin(color);
            for (int k = 0; k < v[2]; k++) hmi_poly_point(SX(v[3 + k * 2]), SY(v[4 + k * 2]));
            hmi_poly_end();
            i += 3u + (size_t)v[2] * 2u;
        } else {
            const int32_t x = SX(v[2]), y = SY(v[3]);
            hmi_fill_rect(x, y, SX(v[2] + v[4]) - x, SY(v[3] + v[5]) - y, v[6] * cap / SPLASH_NAME_H, color);
            i += 7u;
        }
    }
#undef SX
#undef SY
}

void hmi_splash_draw(int holding) {
    const int32_t w = S->w_lu, h = S->h_lu;
    hmi_clear(SPLASH_BACKGROUND);
    int32_t mark_h = h * 30 / 100;
    int32_t cap = mark_h * 30 / 100;
    if (cap * SPLASH_NAME_W / SPLASH_NAME_H > w * 80 / 100) {
        cap = w * 80 / 100 * SPLASH_NAME_H / SPLASH_NAME_W;
        mark_h = cap * 100 / 30;
    }
    const int32_t mark_w = mark_h * SPLASH_MARK_W / SPLASH_MARK_H;
    const int32_t name_w = cap * SPLASH_NAME_W / SPLASH_NAME_H;
    const int32_t gap = mark_h / 5;
    const int32_t top = (h - (mark_h + gap + cap)) / 2;
    splash_chevron_draw((w - mark_w) / 2, top, mark_h, SPLASH_MARK_H, 0);
    splash_chevron_draw((w - mark_w) / 2, top, mark_h, SPLASH_MARK_H, 1);
    splash_name_draw((w - name_w) / 2, top + mark_h + gap, cap);
    if (holding)
        hmi_text(w / 2, h - 30, "Keep holding to calibrate the touch", -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_CENTER,
                 SPLASH_HINT);
}

/* ---- touch calibration ---- */

void hmi_cal_setup(int enabled) {
    S->cal_enabled = enabled != 0;
    if (!S->cal_enabled) S->cal_active = 0;
}

void hmi_calibrate(void) {
    if (!S->cal_enabled || S->cal_active) return;
    S->cal_active = 1;
    S->cal_failed = 0;
    S->cal_done = 0;
    S->cal_target = 0;
    S->cal_down = 0;
    S->cal_n = 0;
}

int hmi_cal_active(void) { return S->cal_active; }

/* Centre of target i in logical units: the corners inset by an eighth of the short side, then the centre. */
static void cal_target_at(int i, int32_t *x, int32_t *y) {
    int32_t side = S->w_lu < S->h_lu ? S->w_lu : S->h_lu;
    int32_t in = side / 8 > 20 ? side / 8 : 20;
    static const int8_t corner[HMI_CAL_TARGETS][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}, {-1, -1}};
    if (corner[i][0] < 0) {
        *x = S->w_lu / 2;
        *y = S->h_lu / 2;
        return;
    }
    *x = corner[i][0] ? S->w_lu - in : in;
    *y = corner[i][1] ? S->h_lu - in : in;
}

static int32_t median_of(int32_t *v, int n) {
    for (int a = 1; a < n; a++)
        for (int b = a; b > 0 && v[b] < v[b - 1]; b--) {
            int32_t t = v[b];
            v[b] = v[b - 1];
            v[b - 1] = t;
        }
    return v[n / 2];
}

/* Cross product of (ax, ay) and (bx, by). */
static int64_t cross64(int64_t ax, int64_t ay, int64_t bx, int64_t by) { return ax * by - ay * bx; }

/* Smallest area, in squared raw units, of the four triangles together; less means the presses barely moved. */
#define CAL_MIN_AREA 40000
/* Smallest share of that total any one triangle may have, as 1 in CAL_MIN_SHARE. */
#define CAL_MIN_SHARE 16

/*
 * Whether raw points (corners in screen order, then the centre) determine a map: every triangle of two neighbouring
 * corners and the centre turns the same way and is not too thin, so the centre lies inside the corners and no press
 * was out of order.
 */
static int cal_points_valid(const int32_t *p) {
    const int64_t cx = p[8], cy = p[9];
    int64_t area[4], total = 0;
    int sign = 0;
    for (int i = 0; i < 4; i++) {
        const int j = (i + 1) % 4;
        area[i] = cross64(p[i * 2] - cx, p[i * 2 + 1] - cy, p[j * 2] - cx, p[j * 2 + 1] - cy);
        const int s = area[i] > 0 ? 1 : area[i] < 0 ? -1 : 0;
        if (s == 0 || (sign != 0 && s != sign)) return 0;
        sign = s;
        total += area[i] * s;
    }
    if (total < CAL_MIN_AREA) return 0;
    for (int i = 0; i < 4; i++)
        if (area[i] * sign * CAL_MIN_SHARE < total) return 0;
    return 1;
}

static int64_t div_round(int64_t n, int64_t d) {
    if (d < 0) {
        n = -n;
        d = -d;
    }
    return n >= 0 ? (n + d / 2) / d : -((-n + d / 2) / d);
}

int hmi_cal_point(int32_t rx, int32_t ry, int32_t *x_q4, int32_t *y_q4) {
    if (!S->cal_ok) return 0;
    const int32_t *p = S->cal_pts;
    const int64_t cx = p[8], cy = p[9], dx = rx - cx, dy = ry - cy;
    int32_t tc_x, tc_y;
    cal_target_at(4, &tc_x, &tc_y);
    int sector = 0;
    for (int i = 0; i < 4; i++) {
        const int j = (i + 1) % 4;
        const int64_t ax = p[i * 2] - cx, ay = p[i * 2 + 1] - cy, bx = p[j * 2] - cx, by = p[j * 2 + 1] - cy;
        const int64_t a = cross64(ax, ay, bx, by);
        if ((a > 0 && cross64(ax, ay, dx, dy) >= 0 && cross64(dx, dy, bx, by) >= 0) ||
            (a < 0 && cross64(ax, ay, dx, dy) <= 0 && cross64(dx, dy, bx, by) <= 0)) {
            sector = i;
            break;
        }
    }
    const int j = (sector + 1) % 4;
    const int64_t ax = p[sector * 2] - cx, ay = p[sector * 2 + 1] - cy, bx = p[j * 2] - cx, by = p[j * 2 + 1] - cy;
    const int64_t a = cross64(ax, ay, bx, by), u = cross64(dx, dy, bx, by), v = cross64(ax, ay, dx, dy);
    int32_t ti_x, ti_y, tj_x, tj_y;
    cal_target_at(sector, &ti_x, &ti_y);
    cal_target_at(j, &tj_x, &tj_y);
    *x_q4 = (int32_t)(tc_x * 16 + div_round(u * (ti_x - tc_x) * 16 + v * (tj_x - tc_x) * 16, a));
    *y_q4 = (int32_t)(tc_y * 16 + div_round(u * (ti_y - tc_y) * 16 + v * (tj_y - tc_y) * 16, a));
    return 1;
}

int hmi_cal_use(const int32_t raw[HMI_CAL_TARGETS * 2]) {
    if (!cal_points_valid(raw)) return 0;
    memcpy(S->cal_pts, raw, sizeof S->cal_pts);
    S->cal_ok = 1;
    return 1;
}

/* Takes the targets' points when they determine a map; otherwise the calibration starts over. */
static void cal_finish(void) {
    S->cal_target = 0;
    if (!hmi_cal_use(S->cal_raw)) {
        S->cal_failed = 1;
        return;
    }
    S->cal_active = 0;
    S->cal_done = 1;
    S->last_touch_ms = S->time_ms;
}

void hmi_cal_raw(int32_t x, int32_t y, int down) {
    if (!S->cal_active) return;
    if (down) {
        if (!S->cal_down) S->cal_n = 0;
        S->cal_down = 1;
        if (S->cal_n < HMI_CAL_SAMPLES) {
            S->cal_sx[S->cal_n] = x;
            S->cal_sy[S->cal_n] = y;
            S->cal_n++;
        }
        return;
    }
    if (!S->cal_down) return;
    S->cal_down = 0;
    if (S->cal_n < 3) return;
    S->cal_raw[S->cal_target * 2] = median_of(S->cal_sx, S->cal_n);
    S->cal_raw[S->cal_target * 2 + 1] = median_of(S->cal_sy, S->cal_n);
    S->cal_failed = 0;
    if (++S->cal_target == HMI_CAL_TARGETS) cal_finish();
}

int hmi_cal_take(int32_t raw[HMI_CAL_TARGETS * 2]) {
    if (!S->cal_done) return 0;
    S->cal_done = 0;
    memcpy(raw, S->cal_pts, sizeof S->cal_pts);
    return 1;
}

void hmi_cal_draw(void) {
    const uint32_t tok = HMI_COLOR_TOKEN;
    char step[24];
    int32_t x, y;
    hmi_clear(tok | HMI_TOKEN_BACKGROUND);
    if (!S->cal_active) return;
    hmi_text(S->w_lu / 2, S->h_lu / 2 - 44, "Touch calibration", -1, 16, HMI_FONT_REGULAR, HMI_ALIGN_CENTER,
             tok | HMI_TOKEN_TEXT);
    hmi_text(S->w_lu / 2, S->h_lu / 2 + 26, S->cal_failed ? "Missed. Tap each cross again" : "Tap the centre of the cross",
             -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_CENTER, tok | (S->cal_failed ? HMI_TOKEN_DANGER : HMI_TOKEN_TEXT_MUTED));
    step[0] = (char)('1' + S->cal_target);
    memcpy(step + 1, " of 5", 6);
    hmi_text(S->w_lu / 2, S->h_lu / 2 + 46, step, -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_CENTER,
             tok | HMI_TOKEN_TEXT_MUTED);
    cal_target_at(S->cal_target, &x, &y);
    if (S->cal_down) hmi_fill_circle(x, y, 10, tok | HMI_TOKEN_ACCENT);
    hmi_stroke_circle(x, y, 10, 2, tok | HMI_TOKEN_ACCENT);
    hmi_line(x - 18, y, x + 18, y, 2, tok | HMI_TOKEN_TEXT);
    hmi_line(x, y - 18, x, y + 18, 2, tok | HMI_TOKEN_TEXT);
}
