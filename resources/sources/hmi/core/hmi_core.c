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
    int bounds_n;

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
    int32_t theme;

    /* Frame: screen_q4 = local_q4 * fk / 65536 + (fox, foy), clipped to (fcx, fcy, fcw, fch) when fclip. */
    int32_t fk, fox, foy, fcx, fcy, fcw, fch;
    int fclip, design;
};

static hmi_session_t g_default = {.fk = Q16_ONE};
static hmi_session_t *S = &g_default;

/* ---- sessions ---- */

hmi_session_t *hmi_session_create(void) {
    hmi_session_t *s = (hmi_session_t *)calloc(1, sizeof(hmi_session_t));
    if (s) s->fk = Q16_ONE;
    return s;
}

void hmi_session_destroy(hmi_session_t *s) {
    if (!s || s == &g_default) return;
    if (S == s) S = &g_default;
    free(s);
}

void hmi_session_use(hmi_session_t *s) { S = s ? s : &g_default; }

size_t hmi_session_size(void) { return sizeof(hmi_session_t); }

void hmi_core_init(int32_t width_lu, int32_t height_lu) {
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
    put_u32(HMI_DL_MAGIC);
    put_u16(HMI_DL_VERSION);
    put_u16(0);
    put_i32(S->w_lu);
    put_i32(S->h_lu);
    put_u32(0); /* command count, set by hmi_frame_end */

    S->pressed = S->released = S->consumed = 0;
    int prev_bounds = S->bounds_n;
    S->bounds_n = 0;
    hmi_frame_reset();

    /* At most one press or release per frame, so a quick tap is seen as both; moves apply in passing. */
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
    return sat32(floor_div(((int64_t)screen_q4 - off_q4) * Q16_ONE, (int64_t)S->fk * 16));
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
    if (S->bounds_n >= HMI_BOUNDS_MAX) {
        S->status |= HMI_STATUS_BOUNDS_FULL;
        return;
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

int hmi_page_back(void) {
    if (S->page_hist_n == 0) return 0;
    S->page = S->page_hist[--S->page_hist_n];
    return 1;
}
