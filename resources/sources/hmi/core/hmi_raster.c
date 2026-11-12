/*
 * HMI rasterizer: replays a display list into an RGBA8888 band. Geometry is integer fixed point with 4x4
 * supersampling, so every compiler and architecture produces the same pixels.
 */
#include <stdlib.h>
#include <string.h>

#include "hmi_internal.h"

#define SS 4 /* samples per axis; SS * SS == 16 */
/* Device coordinates are clamped to +-2^25 in Q8 (131072 px): differences fit 26 bits, products 53. */
#define Q8_LIMIT (1 << 25)
#define MAX_SCALE_Q8 (1 << 16)
#define MAX_SURFACE 32768 /* pixels per side */

static const int32_t k_sample[SS] = {32, 96, 160, 224}; /* Q8 offsets inside a pixel */

/* sin over a quarter turn in 256 steps, Q15. */
static const int16_t k_quarter[257] = {
    0, 201, 402, 603, 804, 1005, 1206, 1407, 1608, 1809, 2009, 2210,
    2410, 2611, 2811, 3012, 3212, 3412, 3612, 3811, 4011, 4210, 4410, 4609,
    4808, 5007, 5205, 5404, 5602, 5800, 5998, 6195, 6393, 6590, 6786, 6983,
    7179, 7375, 7571, 7767, 7962, 8157, 8351, 8545, 8739, 8933, 9126, 9319,
    9512, 9704, 9896, 10087, 10278, 10469, 10659, 10849, 11039, 11228, 11417, 11605,
    11793, 11980, 12167, 12353, 12539, 12725, 12910, 13094, 13279, 13462, 13645, 13828,
    14010, 14191, 14372, 14553, 14732, 14912, 15090, 15269, 15446, 15623, 15800, 15976,
    16151, 16325, 16499, 16673, 16846, 17018, 17189, 17360, 17530, 17700, 17869, 18037,
    18204, 18371, 18537, 18703, 18868, 19032, 19195, 19357, 19519, 19680, 19841, 20000,
    20159, 20317, 20475, 20631, 20787, 20942, 21096, 21250, 21403, 21554, 21705, 21856,
    22005, 22154, 22301, 22448, 22594, 22739, 22884, 23027, 23170, 23311, 23452, 23592,
    23731, 23870, 24007, 24143, 24279, 24413, 24547, 24680, 24811, 24942, 25072, 25201,
    25329, 25456, 25582, 25708, 25832, 25955, 26077, 26198, 26319, 26438, 26556, 26674,
    26790, 26905, 27019, 27133, 27245, 27356, 27466, 27575, 27683, 27790, 27896, 28001,
    28105, 28208, 28310, 28411, 28510, 28609, 28706, 28803, 28898, 28992, 29085, 29177,
    29268, 29358, 29447, 29534, 29621, 29706, 29791, 29874, 29956, 30037, 30117, 30195,
    30273, 30349, 30424, 30498, 30571, 30643, 30714, 30783, 30852, 30919, 30985, 31050,
    31113, 31176, 31237, 31297, 31356, 31414, 31470, 31526, 31580, 31633, 31685, 31736,
    31785, 31833, 31880, 31926, 31971, 32014, 32057, 32098, 32137, 32176, 32213, 32250,
    32285, 32318, 32351, 32382, 32412, 32441, 32469, 32495, 32521, 32545, 32567, 32589,
    32609, 32628, 32646, 32663, 32678, 32692, 32705, 32717, 32728, 32737, 32745, 32752,
    32757, 32761, 32765, 32766, 32767,
};

#define MUL64(a, b) ((int64_t)(a) * (int64_t)(b))

static int64_t floor_div(int64_t n, int64_t d) {
    int64_t q = n / d;
    return (n % d != 0 && n < 0) ? q - 1 : q;
}

static int32_t clamp_q8(int64_t v) { return (int32_t)(v > Q8_LIMIT ? Q8_LIMIT : v < -Q8_LIMIT ? -Q8_LIMIT : v); }
/* Q4 logical -> Q8 device: positions get the surface offset, lengths do not. */
static int32_t pos_x(const hmi_raster_ctx_t *c, int32_t v) { return clamp_q8(floor_div(MUL64(v, c->scale_q8), 16) + MUL64(c->off_x, 256)); }
static int32_t pos_y(const hmi_raster_ctx_t *c, int32_t v) { return clamp_q8(floor_div(MUL64(v, c->scale_q8), 16) + MUL64(c->off_y, 256)); }
static int32_t len_q8(const hmi_raster_ctx_t *c, int32_t v) { return clamp_q8(floor_div(MUL64(v, c->scale_q8), 16)); }
/* Same for a position computed in 64 bits (x + w). */
static int32_t pos_x64(const hmi_raster_ctx_t *c, int64_t v) { return pos_x(c, (int32_t)(v > INT32_MAX ? INT32_MAX : v < INT32_MIN ? INT32_MIN : v)); }
static int32_t pos_y64(const hmi_raster_ctx_t *c, int64_t v) { return pos_y(c, (int32_t)(v > INT32_MAX ? INT32_MAX : v < INT32_MIN ? INT32_MIN : v)); }

static hmi_irect_t isect(hmi_irect_t a, hmi_irect_t b) {
    hmi_irect_t r;
    r.x0 = a.x0 > b.x0 ? a.x0 : b.x0;
    r.y0 = a.y0 > b.y0 ? a.y0 : b.y0;
    r.x1 = a.x1 < b.x1 ? a.x1 : b.x1;
    r.y1 = a.y1 < b.y1 ? a.y1 : b.y1;
    return r;
}

static hmi_irect_t rect_px(int32_t x0, int32_t y0, int32_t x1, int32_t y1) {
    hmi_irect_t r = {hmi_floor8(x0), hmi_floor8(y0), hmi_ceil8(x1), hmi_ceil8(y1)};
    return r;
}

int hmi_raster_expired(hmi_raster_ctx_t *c) {
    if (c->aborted) return 1;
    if (c->clock && (int32_t)(c->clock() - c->deadline) >= 0) c->aborted = 1;
    return c->aborted;
}

/* floor(v / 255) for 0 <= v <= 65535, without a division. */
static uint32_t div255(uint32_t v) { return (v + 1 + (v >> 8)) >> 8; }

static uint8_t *pixel(const hmi_raster_ctx_t *c, int x, int y) {
    HMI_ASSERT(x >= c->clip.x0 && x < c->clip.x1 && y >= c->clip.y0 && y < c->clip.y1);
    return c->rgba + ((size_t)(y - c->band.y0) * (size_t)c->stride + (size_t)x) * 4;
}

static void blend_alpha(uint8_t *p, uint32_t argb, uint32_t alpha) {
    if (alpha == 255) {
        p[0] = (uint8_t)(argb >> 16);
        p[1] = (uint8_t)(argb >> 8);
        p[2] = (uint8_t)argb;
        p[3] = 255;
        return;
    }
    uint32_t ia = 255 - alpha;
    p[0] = (uint8_t)div255(((argb >> 16) & 0xFF) * alpha + p[0] * ia + 127);
    p[1] = (uint8_t)div255(((argb >> 8) & 0xFF) * alpha + p[1] * ia + 127);
    p[2] = (uint8_t)div255((argb & 0xFF) * alpha + p[2] * ia + 127);
    p[3] = (uint8_t)(alpha + div255(p[3] * ia + 127));
}

/* Blends with a sample coverage of 0..16. */
static void blend(const hmi_raster_ctx_t *c, int x, int y, uint32_t argb, int cov) {
    HMI_ASSERT(cov >= 0 && cov <= SS * SS);
    if (cov <= 0) return;
    uint32_t alpha = (((argb >> 24) & 0xFF) * (uint32_t)cov + (SS * SS) / 2) >> 4;
    if (alpha) blend_alpha(pixel(c, x, y), argb, alpha);
}

void hmi_raster_blend_a8(const hmi_raster_ctx_t *c, int x, int y, uint32_t argb, uint32_t a8) {
    uint32_t alpha = div255(((argb >> 24) & 0xFF) * a8 + 127);
    if (alpha) blend_alpha(pixel(c, x, y), argb, alpha);
}

/* An opaque run of pixels on row y. */
static void fill_span(const hmi_raster_ctx_t *c, int x0, int x1, int y, uint32_t argb) {
    uint8_t *p = pixel(c, x0, y);
    uint8_t r = (uint8_t)(argb >> 16), g = (uint8_t)(argb >> 8), b = (uint8_t)argb;
    for (int x = x0; x < x1; x++, p += 4) {
        p[0] = r;
        p[1] = g;
        p[2] = b;
        p[3] = 255;
    }
}

/* ---- rounded rectangles ---- */

typedef struct {
    int32_t x0, y0, x1, y1, r; /* Q8 device, r <= half of the shorter side */
} rrect_t;

static rrect_t make_rrect(int32_t x0, int32_t y0, int32_t x1, int32_t y1, int32_t r) {
    rrect_t s = {x0, y0, x1, y1, r < 0 ? 0 : r};
    int32_t half_w = x1 > x0 ? (x1 - x0) / 2 : 0, half_h = y1 > y0 ? (y1 - y0) / 2 : 0;
    if (s.r > half_w) s.r = half_w;
    if (s.r > half_h) s.r = half_h;
    return s;
}

static int in_rrect(const rrect_t *s, int32_t px, int32_t py) {
    if (px < s->x0 || px >= s->x1 || py < s->y0 || py >= s->y1) return 0;
    if (s->r <= 0) return 1;
    int32_t cx, cy;
    if (px < s->x0 + s->r)
        cx = s->x0 + s->r;
    else if (px >= s->x1 - s->r)
        cx = s->x1 - s->r;
    else
        return 1;
    if (py < s->y0 + s->r)
        cy = s->y0 + s->r;
    else if (py >= s->y1 - s->r)
        cy = s->y1 - s->r;
    else
        return 1;
    int32_t dx = px - cx, dy = py - cy;
    return MUL64(dx, dx) + MUL64(dy, dy) <= MUL64(s->r, s->r);
}

/* Pixel square [px0, px0 + 256) x [py0, py0 + 256) lies in the straight (non-corner) part of s. */
static int square_inside(const rrect_t *s, int32_t px0, int32_t py0) {
    return (px0 >= s->x0 + s->r && px0 + 256 <= s->x1 - s->r && py0 >= s->y0 && py0 + 256 <= s->y1) ||
           (px0 >= s->x0 && px0 + 256 <= s->x1 && py0 >= s->y0 + s->r && py0 + 256 <= s->y1 - s->r);
}

static int square_outside(const rrect_t *s, int32_t px0, int32_t py0) {
    return px0 + 256 <= s->x0 || px0 >= s->x1 || py0 + 256 <= s->y0 || py0 >= s->y1;
}

/* Fills s, minus `hole` when given (strokes). */
static void fill_rrect(hmi_raster_ctx_t *c, const rrect_t *s, uint32_t argb, const rrect_t *hole) {
    hmi_irect_t r = isect(rect_px(s->x0, s->y0, s->x1, s->y1), c->clip);
    int opaque = ((argb >> 24) & 0xFF) == 255 && !hole;
    for (int y = r.y0; y < r.y1; y++) {
        if (hmi_raster_expired(c)) return;
        int32_t py0 = y * 256;
        /* Opaque interior run of this row: pixels whose whole square is inside the shape. */
        int run0 = r.x1, run1 = r.x1;
        if (opaque && py0 >= s->y0 && py0 + 256 <= s->y1) {
            int corner = py0 < s->y0 + s->r || py0 + 256 > s->y1 - s->r;
            run0 = hmi_ceil8(corner ? s->x0 + s->r : s->x0);
            run1 = hmi_floor8(corner ? s->x1 - s->r : s->x1);
            if (run0 < r.x0) run0 = r.x0;
            if (run1 > r.x1) run1 = r.x1;
            if (run1 <= run0) run0 = run1 = r.x1;
        }
        for (int x = r.x0; x < r.x1; x++) {
            if (x == run0) {
                fill_span(c, run0, run1, y, argb);
                x = run1 - 1;
                continue;
            }
            int32_t px0 = x * 256;
            if (hole && square_inside(hole, px0, py0)) continue;
            int cov = 0;
            if (square_inside(s, px0, py0) && (!hole || square_outside(hole, px0, py0))) {
                cov = SS * SS;
            } else {
                for (int j = 0; j < SS; j++)
                    for (int i = 0; i < SS; i++) {
                        int32_t sx = px0 + k_sample[i], sy = py0 + k_sample[j];
                        if (in_rrect(s, sx, sy) && !(hole && in_rrect(hole, sx, sy))) cov++;
                    }
            }
            blend(c, x, y, argb, cov);
        }
    }
}

/* ---- arcs and circles ---- */

/* Angle in Q6 degrees -> sin and cos in Q15, from the quarter-wave table (90/256 degree steps). */
static void sincos_q6(int64_t a, int32_t *s, int32_t *co) {
    int64_t t = a % (360 * 64);
    if (t < 0) t += 360 * 64;
    int64_t idx = (t * 256) / (90 * 64); /* 0..1023 */
    int q = (int)(idx / 256), k = (int)(idx % 256);
    switch (q) {
    case 0: *s = k_quarter[k]; *co = k_quarter[256 - k]; break;
    case 1: *s = k_quarter[256 - k]; *co = -k_quarter[k]; break;
    case 2: *s = -k_quarter[k]; *co = -k_quarter[256 - k]; break;
    default: *s = -k_quarter[256 - k]; *co = k_quarter[k]; break;
    }
}

typedef struct {
    int32_t cx, cy;
    int64_t ri2, ro2; /* ri2 < 0: no inner radius (filled circle) */
    int full;
    int big;                /* sweep > 180 degrees */
    int32_t sx, sy, ex, ey; /* start and end directions, Q15 */
} arc_t;

static int in_sector(const arc_t *a, int64_t c1, int64_t c2) { return a->big ? (c1 >= 0 || c2 >= 0) : (c1 >= 0 && c2 >= 0); }

static int in_arc(const arc_t *a, int32_t px, int32_t py) {
    int32_t dx = px - a->cx, dy = py - a->cy;
    int64_t d2 = MUL64(dx, dx) + MUL64(dy, dy);
    if (d2 > a->ro2 || d2 < a->ri2) return 0;
    if (a->full) return 1;
    /* y grows down, angles grow clockwise: c1 >= 0 when p is clockwise from start, c2 >= 0 when end is from p. */
    int64_t c1 = MUL64(a->sx, dy) - MUL64(a->sy, dx);
    int64_t c2 = MUL64(dx, a->ey) - MUL64(dy, a->ex);
    return in_sector(a, c1, c2);
}

static int64_t isqrt64(int64_t v) {
    if (v <= 0) return 0;
    uint64_t x = (uint64_t)v, r = 0, bit = (uint64_t)1 << 62;
    while (bit > x) bit >>= 2;
    while (bit) {
        if (x >= r + bit) {
            x -= r + bit;
            r = (r >> 1) + bit;
        } else {
            r >>= 1;
        }
        bit >>= 2;
    }
    return (int64_t)r;
}

static void fill_arc(hmi_raster_ctx_t *c, const arc_t *a, int32_t ro, uint32_t argb) {
    /* Pixel-centre classification: samples lie within 136 Q8 of the centre, so 192 is a safe margin. */
    int32_t ri = a->ri2 > 0 ? (int32_t)isqrt64(a->ri2) : 0;
    int64_t out2 = MUL64(ro + 192, ro + 192);
    int64_t in2 = ri > 192 ? MUL64(ri - 192, ri - 192) : -1;
    int64_t full_hi2 = ro > 192 ? MUL64(ro - 192, ro - 192) : -1;
    int64_t full_lo2 = a->ri2 >= 0 ? MUL64(ri + 192, ri + 192) : 0;
    int64_t margin = (int64_t)192 << 15;
    hmi_irect_t r = isect(rect_px(a->cx - ro, a->cy - ro, a->cx + ro, a->cy + ro), c->clip);
    for (int y = r.y0; y < r.y1; y++) {
        if (hmi_raster_expired(c)) return;
        for (int x = r.x0; x < r.x1; x++) {
            int32_t px0 = x * 256, py0 = y * 256;
            int32_t dx = px0 + 128 - a->cx, dy = py0 + 128 - a->cy;
            int64_t d2 = MUL64(dx, dx) + MUL64(dy, dy);
            int cov = -1;
            if (d2 > out2 || (a->ri2 >= 0 && d2 < in2)) {
                cov = 0;
            } else if (d2 <= full_hi2 && d2 >= full_lo2) {
                if (a->full) {
                    cov = SS * SS;
                } else {
                    int64_t c1 = MUL64(a->sx, dy) - MUL64(a->sy, dx), c2 = MUL64(dx, a->ey) - MUL64(dy, a->ex);
                    if ((c1 > margin || c1 < -margin) && (c2 > margin || c2 < -margin))
                        cov = in_sector(a, c1, c2) ? SS * SS : 0;
                }
            }
            if (cov < 0) {
                cov = 0;
                for (int j = 0; j < SS; j++)
                    for (int i = 0; i < SS; i++)
                        if (in_arc(a, px0 + k_sample[i], py0 + k_sample[j])) cov++;
            }
            blend(c, x, y, argb, cov);
        }
    }
}

/* ---- lines (round caps) ---- */

static void draw_line(hmi_raster_ctx_t *c, int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t w, uint32_t argb) {
    int32_t hw = w / 2;
    if (hw < 64) hw = 64; /* at least half a device pixel wide */
    int32_t minx = (x1 < x2 ? x1 : x2) - hw, maxx = (x1 > x2 ? x1 : x2) + hw;
    int32_t miny = (y1 < y2 ? y1 : y2) - hw, maxy = (y1 > y2 ? y1 : y2) + hw;
    hmi_irect_t r = isect(rect_px(minx, miny, maxx, maxy), c->clip);
    int32_t vx = x2 - x1, vy = y2 - y1;
    int64_t len2 = MUL64(vx, vx) + MUL64(vy, vy);
    int64_t len = isqrt64(len2);
    int64_t hw2 = MUL64(hw, hw);
    int64_t in_lim = hw > 192 ? (int64_t)(hw - 192) * len : -1, out_lim = (int64_t)(hw + 192) * len;
    int64_t mid_lo = 192 * len, mid_hi = len2 - 192 * len;
    for (int y = r.y0; y < r.y1; y++) {
        if (hmi_raster_expired(c)) return;
        for (int x = r.x0; x < r.x1; x++) {
            if (len2 > 0) {
                int32_t pcx = x * 256 + 128 - x1, pcy = y * 256 + 128 - y1;
                int64_t cr = MUL64(pcx, vy) - MUL64(pcy, vx);
                if (cr < 0) cr = -cr;
                if (cr > out_lim) continue; /* every sample is outside the strip, caps included */
                int64_t tc = MUL64(pcx, vx) + MUL64(pcy, vy);
                if (cr <= in_lim && tc >= mid_lo && tc <= mid_hi) {
                    blend(c, x, y, argb, SS * SS);
                    continue;
                }
            }
            int cov = 0;
            for (int j = 0; j < SS; j++)
                for (int i = 0; i < SS; i++) {
                    int32_t px = x * 256 + k_sample[i] - x1, py = y * 256 + k_sample[j] - y1;
                    int32_t dx = px, dy = py;
                    if (len2 > 0) {
                        int64_t t = MUL64(px, vx) + MUL64(py, vy); /* projection times len2 */
                        if (t >= len2) {
                            dx = px - vx;
                            dy = py - vy;
                        } else if (t > 0) {
                            int64_t cr = MUL64(px, vy) - MUL64(py, vx);
                            if (cr < 0) cr = -cr;
                            if (cr <= (int64_t)hw * len) cov++;
                            continue;
                        }
                    }
                    if (MUL64(dx, dx) + MUL64(dy, dy) <= hw2) cov++;
                }
            blend(c, x, y, argb, cov);
        }
    }
}

/* ---- polygons: scanline fill, non-zero winding, same sample grid ---- */

/* Per-column coverage differences of one pixel row, grown to the widest clip seen. */
static int16_t *g_diff;
static int g_diff_cap;

static int16_t *diff_buffer(int n) {
    if (n > g_diff_cap) {
        int16_t *p = (int16_t *)realloc(g_diff, sizeof(int16_t) * (size_t)n);
        if (!p) return NULL;
        g_diff = p;
        g_diff_cap = n;
    }
    return g_diff;
}

typedef struct {
    int64_t tx, ty, by, uy, aux, q, rem, qs, rs;
    int8_t d, sgn, live;
} edge_t;

static void fill_poly(hmi_raster_ctx_t *c, const int32_t *xs, const int32_t *ys, int n, uint32_t argb) {
    int32_t minx = xs[0], maxx = xs[0], miny = ys[0], maxy = ys[0];
    for (int i = 1; i < n; i++) {
        if (xs[i] < minx) minx = xs[i];
        if (xs[i] > maxx) maxx = xs[i];
        if (ys[i] < miny) miny = ys[i];
        if (ys[i] > maxy) maxy = ys[i];
    }
    hmi_irect_t r = isect(rect_px(minx, miny, maxx, maxy), c->clip);
    int w = r.x1 - r.x0;
    if (w <= 0 || r.y1 <= r.y0) return;
    int16_t *diff = diff_buffer(w + 1);
    if (!diff) return;
    /* Edges top-down, stepped one sample row (64 Q8) at a time without a division per row:
     * x = tx + sgn * floor(aux * (py - ty) / uy), kept as quotient q and remainder rem. */
    edge_t e[HMI_POLY_MAX];
    int ne = 0;
    for (int k = 0, l = n - 1; k < n; l = k++) {
        int64_t ax = xs[l], ay = ys[l], bx = xs[k], by = ys[k];
        if (ay == by) continue;
        int8_t d = 1;
        if (by < ay) {
            int64_t t = ax;
            ax = bx;
            bx = t;
            t = ay;
            ay = by;
            by = t;
            d = -1;
        }
        edge_t *E = &e[ne++];
        E->tx = ax;
        E->ty = ay;
        E->by = by;
        E->uy = by - ay;
        E->d = d;
        E->sgn = (int8_t)(bx < ax ? -1 : 1);
        E->aux = bx < ax ? ax - bx : bx - ax;
        E->qs = E->aux * 64 / E->uy;
        E->rs = E->aux * 64 % E->uy;
        E->live = 0;
    }
    int64_t cx[HMI_POLY_MAX];
    int8_t cd[HMI_POLY_MAX];
    for (int y = r.y0; y < r.y1; y++) {
        if (hmi_raster_expired(c)) return;
        memset(diff, 0, sizeof(diff[0]) * (size_t)(w + 1));
        for (int j = 0; j < SS; j++) {
            int64_t py = (int64_t)y * 256 + k_sample[j];
            int m = 0;
            for (int k = 0; k < ne; k++) {
                edge_t *E = &e[k];
                if (py < E->ty || py >= E->by) continue;
                if (!E->live) {
                    int64_t num = E->aux * (py - E->ty);
                    E->q = num / E->uy;
                    E->rem = num % E->uy;
                    E->live = 1;
                }
                int64_t x = E->tx + E->sgn * E->q;
                E->q += E->qs;
                E->rem += E->rs;
                if (E->rem >= E->uy) {
                    E->q++;
                    E->rem -= E->uy;
                }
                int t = m++;
                while (t > 0 && cx[t - 1] > x) {
                    cx[t] = cx[t - 1];
                    cd[t] = cd[t - 1];
                    t--;
                }
                cx[t] = x;
                cd[t] = E->d;
            }
            int wind = 0;
            for (int t = 0; t + 1 < m; t++) {
                wind += cd[t];
                if (wind == 0) continue;
                /* Sample columns px = x * 256 + k_sample[i] with cx[t] <= px < cx[t + 1]. */
                for (int i = 0; i < SS; i++) {
                    int32_t x0 = hmi_ceil8((int32_t)(cx[t] - k_sample[i]));
                    int32_t x1 = hmi_ceil8((int32_t)(cx[t + 1] - k_sample[i]));
                    if (x0 < r.x0) x0 = r.x0;
                    if (x1 > r.x1) x1 = r.x1;
                    if (x0 >= x1) continue;
                    diff[x0 - r.x0]++;
                    diff[x1 - r.x0]--;
                }
            }
        }
        int cov = 0;
        for (int x = 0; x < w; x++) {
            cov += diff[x];
            if (cov) blend(c, r.x0 + x, y, argb, cov);
        }
    }
}

/* ---- command walk ---- */

/*
 * Payload size of the command at p (after the opcode) and the device rows [*y0, *y1) it can touch, conservatively.
 * Returns 0 for a drawing command, 1 for CLIP/UNCLIP (no rows), or HMI_RASTER_MALFORMED.
 */
static int cmd_extent(const hmi_raster_ctx_t *c, uint8_t op, const uint8_t *p, const uint8_t *end, size_t *sz,
                      int32_t *y0, int32_t *y1) {
    size_t avail = (size_t)(end - p);
    int32_t ya = 0, yb = 0;
    switch (op) {
    case HMI_OP_CLEAR:
        *sz = HMI_PAYLOAD_CLEAR;
        *y0 = INT32_MIN / 2;
        *y1 = INT32_MAX / 2;
        return avail >= *sz ? 0 : HMI_RASTER_MALFORMED;
    case HMI_OP_RECT:
    case HMI_OP_RECT_STROKE:
        *sz = op == HMI_OP_RECT ? HMI_PAYLOAD_RECT : HMI_PAYLOAD_RECT_STROKE;
        if (avail < *sz) return HMI_RASTER_MALFORMED;
        ya = pos_y(c, hmi_rd_i32(p + 4));
        yb = pos_y64(c, (int64_t)hmi_rd_i32(p + 4) + hmi_rd_i32(p + 12));
        break;
    case HMI_OP_LINE: {
        *sz = HMI_PAYLOAD_LINE;
        if (avail < *sz) return HMI_RASTER_MALFORMED;
        int32_t a = pos_y(c, hmi_rd_i32(p + 4)), b = pos_y(c, hmi_rd_i32(p + 12)), w = len_q8(c, hmi_rd_i32(p + 16));
        if (w < 0) w = -w;
        if (w < 256) w = 256;
        ya = (a < b ? a : b) - w;
        yb = (a > b ? a : b) + w;
        break;
    }
    case HMI_OP_CIRCLE:
    case HMI_OP_ARC: {
        *sz = op == HMI_OP_CIRCLE ? HMI_PAYLOAD_CIRCLE : HMI_PAYLOAD_ARC;
        if (avail < *sz) return HMI_RASTER_MALFORMED;
        int32_t cy = pos_y(c, hmi_rd_i32(p + 4)), r = len_q8(c, hmi_rd_i32(p + 8));
        if (r < 0) r = -r;
        if (op == HMI_OP_ARC) {
            int32_t w = len_q8(c, hmi_rd_i32(p + 12));
            r += w < 0 ? -w : w;
        }
        ya = cy - r;
        yb = cy + r;
        break;
    }
    case HMI_OP_TEXT: {
        if (avail < HMI_PAYLOAD_TEXT_HEAD) return HMI_RASTER_MALFORMED;
        *sz = HMI_PAYLOAD_TEXT_HEAD + (size_t)hmi_rd_u16(p + 18);
        if (avail < *sz) return HMI_RASTER_MALFORMED;
        int32_t y = pos_y(c, hmi_rd_i32(p + 4)), size = len_q8(c, hmi_rd_i32(p + 8));
        if (size < 0) size = 0;
        ya = y - size / 2; /* marks above the em box */
        yb = y + size * 2; /* descenders */
        break;
    }
    case HMI_OP_CLIP:
        *sz = HMI_PAYLOAD_CLIP;
        return avail >= *sz ? 1 : HMI_RASTER_MALFORMED;
    case HMI_OP_UNCLIP:
        *sz = 0;
        return 1;
    case HMI_OP_POLY: {
        if (avail < HMI_PAYLOAD_POLY_HEAD) return HMI_RASTER_MALFORMED;
        uint16_t np = hmi_rd_u16(p + 4);
        if (np < 3 || np > HMI_POLY_MAX) return HMI_RASTER_MALFORMED;
        *sz = HMI_PAYLOAD_POLY_HEAD + (size_t)np * 8u;
        if (avail < *sz) return HMI_RASTER_MALFORMED;
        ya = yb = pos_y(c, hmi_rd_i32(p + 10));
        for (int i = 1; i < np; i++) {
            int32_t y = pos_y(c, hmi_rd_i32(p + 10 + (size_t)i * 8u));
            if (y < ya) ya = y;
            if (y > yb) yb = y;
        }
        break;
    }
    default:
        return HMI_RASTER_MALFORMED;
    }
    *y0 = hmi_floor8(ya) - 2; /* anti-aliasing and rounding margin */
    *y1 = hmi_ceil8(yb) + 2;
    return 0;
}

static hmi_irect_t clip_rect(const hmi_raster_ctx_t *c, const uint8_t *p) {
    int32_t x = hmi_rd_i32(p), y = hmi_rd_i32(p + 4), w = hmi_rd_i32(p + 8), h = hmi_rd_i32(p + 12);
    return rect_px(pos_x(c, x), pos_y(c, y), pos_x64(c, (int64_t)x + w), pos_y64(c, (int64_t)y + h));
}

static void draw_cmd(hmi_raster_ctx_t *c, uint8_t op, const uint8_t *p) {
    switch (op) {
    case HMI_OP_CLEAR: {
        uint32_t argb = hmi_rd_u32(p);
        for (int y = c->clip.y0; y < c->clip.y1; y++)
            if (c->clip.x1 > c->clip.x0) fill_span(c, c->clip.x0, c->clip.x1, y, argb | 0xFF000000u);
        break;
    }
    case HMI_OP_RECT:
    case HMI_OP_RECT_STROKE: {
        int32_t x = hmi_rd_i32(p), y = hmi_rd_i32(p + 4), w = hmi_rd_i32(p + 8), h = hmi_rd_i32(p + 12);
        rrect_t s = make_rrect(pos_x(c, x), pos_y(c, y), pos_x64(c, (int64_t)x + w), pos_y64(c, (int64_t)y + h),
                               len_q8(c, hmi_rd_i32(p + 16)));
        if (op == HMI_OP_RECT) {
            fill_rrect(c, &s, hmi_rd_u32(p + 20), NULL);
        } else {
            int32_t t = len_q8(c, hmi_rd_i32(p + 20));
            if (t < 256) t = 256; /* at least one device pixel */
            rrect_t hole = make_rrect(s.x0 + t, s.y0 + t, s.x1 - t, s.y1 - t, s.r > t ? s.r - t : 0);
            fill_rrect(c, &s, hmi_rd_u32(p + 24), &hole);
        }
        break;
    }
    case HMI_OP_LINE:
        draw_line(c, pos_x(c, hmi_rd_i32(p)), pos_y(c, hmi_rd_i32(p + 4)), pos_x(c, hmi_rd_i32(p + 8)),
                  pos_y(c, hmi_rd_i32(p + 12)), len_q8(c, hmi_rd_i32(p + 16)), hmi_rd_u32(p + 20));
        break;
    case HMI_OP_CIRCLE: {
        int32_t r = len_q8(c, hmi_rd_i32(p + 8));
        if (r <= 0) break;
        arc_t a = {pos_x(c, hmi_rd_i32(p)), pos_y(c, hmi_rd_i32(p + 4)), -1, MUL64(r, r), 1, 0, 0, 0, 0, 0};
        fill_arc(c, &a, r, hmi_rd_u32(p + 12));
        break;
    }
    case HMI_OP_ARC: {
        int32_t r = len_q8(c, hmi_rd_i32(p + 8)), hw = len_q8(c, hmi_rd_i32(p + 12)) / 2;
        if (hw < 0) hw = -hw;
        int32_t ro = clamp_q8((int64_t)r + hw), ri = clamp_q8((int64_t)r - hw);
        if (ri < 0) ri = 0;
        int64_t a0 = hmi_rd_i32(p + 16), sweep = (int64_t)hmi_rd_i32(p + 20) - a0;
        if (sweep < 0) {
            sweep = -sweep;
            a0 = hmi_rd_i32(p + 20);
        }
        if (sweep == 0 || ro <= 0) break;
        arc_t a;
        a.cx = pos_x(c, hmi_rd_i32(p));
        a.cy = pos_y(c, hmi_rd_i32(p + 4));
        a.ro2 = MUL64(ro, ro);
        a.ri2 = MUL64(ri, ri);
        a.full = sweep >= 360 * 64;
        a.big = sweep > 180 * 64;
        sincos_q6(a0, &a.sy, &a.sx);
        sincos_q6(a0 + sweep, &a.ey, &a.ex);
        fill_arc(c, &a, ro, hmi_rd_u32(p + 24));
        break;
    }
    case HMI_OP_TEXT:
        hmi_raster_text(c, p);
        break;
    case HMI_OP_CLIP:
        c->clip = isect(clip_rect(c, p), c->band);
        break;
    case HMI_OP_UNCLIP:
        c->clip = c->band;
        break;
    case HMI_OP_POLY: {
        int32_t xs[HMI_POLY_MAX], ys[HMI_POLY_MAX];
        int n = hmi_rd_u16(p + 4);
        if (n < 3 || n > HMI_POLY_MAX) break; /* cmd_extent rejects these; repeated for the reader */
        for (int i = 0; i < n; i++) {
            xs[i] = pos_x(c, hmi_rd_i32(p + 6 + (size_t)i * 8u));
            ys[i] = pos_y(c, hmi_rd_i32(p + 10 + (size_t)i * 8u));
        }
        fill_poly(c, xs, ys, n, hmi_rd_u32(p));
        break;
    }
    default:
        break;
    }
}

static int check_header(const uint8_t *dl, size_t len) {
    return dl && len >= HMI_DL_HEADER_SIZE && hmi_rd_u32(dl) == HMI_DL_MAGIC && hmi_rd_u16(dl + 4) == HMI_DL_VERSION;
}

int hmi_raster_render(const uint8_t *dl, size_t len, uint8_t *rgba, int out_w, int out_h, int stride, int band_y0,
                      int band_h, int32_t scale_q8, int32_t offset_x, int32_t offset_y) {
    return hmi_raster_render_until(dl, len, rgba, out_w, out_h, stride, band_y0, band_h, scale_q8, offset_x, offset_y,
                                   NULL, 0);
}

int hmi_raster_render_until(const uint8_t *dl, size_t len, uint8_t *rgba, int out_w, int out_h, int stride,
                            int band_y0, int band_h, int32_t scale_q8, int32_t offset_x, int32_t offset_y,
                            hmi_clock_fn clock, uint32_t deadline_us) {
    if (!check_header(dl, len)) return HMI_RASTER_BAD_LIST;
    if (!rgba || out_w <= 0 || out_h <= 0 || out_w > MAX_SURFACE || out_h > MAX_SURFACE || stride < out_w ||
        band_y0 < 0 || band_h <= 0 || band_y0 > out_h - band_h || scale_q8 <= 0 || scale_q8 > MAX_SCALE_Q8)
        return HMI_RASTER_BAD_ARGS;
    hmi_raster_ctx_t c;
    c.rgba = rgba;
    c.stride = stride;
    c.scale_q8 = scale_q8;
    c.off_x = offset_x;
    c.off_y = offset_y;
    c.band.x0 = 0;
    c.band.y0 = band_y0;
    c.band.x1 = out_w;
    c.band.y1 = band_y0 + band_h;
    c.clip = c.band;
    c.clock = clock;
    c.deadline = deadline_us;
    c.aborted = 0;
    uint32_t n = hmi_rd_u32(dl + 16);
    const uint8_t *p = dl + HMI_DL_HEADER_SIZE, *end = dl + len;
    for (uint32_t k = 0; k < n; k++) {
        if (hmi_raster_expired(&c)) return HMI_RASTER_ABORTED;
        if (p >= end) return HMI_RASTER_MALFORMED;
        uint8_t op = *p++;
        size_t sz;
        int32_t y0, y1;
        int ext = cmd_extent(&c, op, p, end, &sz, &y0, &y1);
        if (ext < 0) return ext;
        /* Commands that cannot reach this band's clipped rows are skipped whole. */
        if (ext == 1 || (y1 > c.clip.y0 && y0 < c.clip.y1)) draw_cmd(&c, op, p);
        p += sz;
    }
    return c.aborted ? HMI_RASTER_ABORTED : HMI_RASTER_OK;
}

/* ---- band hashes ---- */

static uint32_t fnv1a(uint32_t h, const uint8_t *p, size_t n) {
    for (size_t i = 0; i < n; i++) h = (h ^ p[i]) * 16777619u;
    return h;
}

static uint32_t fnv1a_i32(uint32_t h, const int32_t *v, int n) {
    uint8_t b[4];
    for (int i = 0; i < n; i++) {
        hmi_wr_u32(b, (uint32_t)v[i]);
        h = fnv1a(h, b, 4);
    }
    return h;
}

int hmi_raster_band_hashes(const uint8_t *dl, size_t len, int out_w, int out_h, int band_h, int32_t scale_q8,
                           int32_t offset_x, int32_t offset_y, uint32_t *hashes, int nbands) {
    if (!check_header(dl, len)) return HMI_RASTER_BAD_LIST;
    if (!hashes || out_w <= 0 || out_h <= 0 || out_w > MAX_SURFACE || out_h > MAX_SURFACE || band_h <= 0 ||
        nbands <= 0 || scale_q8 <= 0 || scale_q8 > MAX_SCALE_Q8)
        return HMI_RASTER_BAD_ARGS;
    hmi_raster_ctx_t c;
    memset(&c, 0, sizeof c);
    c.scale_q8 = scale_q8;
    c.off_x = offset_x;
    c.off_y = offset_y;
    /* Everything that changes every pixel seeds every band. */
    const int32_t seed[5] = {out_w, out_h, scale_q8, offset_x, offset_y};
    for (int b = 0; b < nbands; b++) hashes[b] = fnv1a_i32(2166136261u, seed, 5);
    int32_t clip[4] = {0, 0, out_w, out_h}; /* x0 y0 x1 y1, device pixels */
    uint32_t n = hmi_rd_u32(dl + 16);
    const uint8_t *p = dl + HMI_DL_HEADER_SIZE, *end = dl + len;
    for (uint32_t k = 0; k < n; k++) {
        if (p >= end) return HMI_RASTER_MALFORMED;
        const uint8_t *cmd = p;
        uint8_t op = *p++;
        size_t sz;
        int32_t y0, y1;
        int ext = cmd_extent(&c, op, p, end, &sz, &y0, &y1);
        if (ext < 0) return ext;
        if (op == HMI_OP_CLIP) {
            hmi_irect_t r = clip_rect(&c, p);
            clip[0] = r.x0;
            clip[1] = r.y0;
            clip[2] = r.x1;
            clip[3] = r.y1;
        } else if (op == HMI_OP_UNCLIP) {
            clip[0] = clip[1] = 0;
            clip[2] = out_w;
            clip[3] = out_h;
        } else {
            int32_t a = y0 > clip[1] ? y0 : clip[1], b = y1 < clip[3] ? y1 : clip[3];
            if (a < 0) a = 0;
            if (b > out_h) b = out_h;
            if (b > a && clip[2] > clip[0]) {
                int b0 = a / band_h, b1 = (b - 1) / band_h;
                if (b1 >= nbands) b1 = nbands - 1;
                for (int i = b0; i <= b1; i++) {
                    hashes[i] = fnv1a(hashes[i], cmd, 1 + sz);
                    hashes[i] = fnv1a_i32(hashes[i], clip, 4);
                }
            }
        }
        p += sz;
    }
    return HMI_RASTER_OK;
}
