/* HMI core: fonts, text metrics, the glyph cache and text drawing. Fonts come only from the generated table. */
/* Float results must match on every target: no fused multiply-add. clang honours this pragma only without
 * -ffp-contract=fast, so builds must pass -ffp-contract=off. */
#if defined(__FAST_MATH__)
#error "the HMI core must not be built with -ffast-math: text pixels would differ between targets"
#endif
#if defined(__clang__)
#pragma STDC FP_CONTRACT OFF
#elif defined(__GNUC__)
#pragma GCC optimize("fp-contract=off")
#endif
#include <stdlib.h>
#include <string.h>

#include "hmi_internal.h"

/* stb_truetype allocations go through here, so a glyph whose rasterization ran out of memory is never drawn or cached. */
static int g_alloc_failed;
#ifdef HMI_TEST_ALLOC_FAIL
int hmi_test_alloc_fail; /* test builds: allocations fail while non-zero */
#endif
static void *stb_alloc(size_t n) {
#ifdef HMI_TEST_ALLOC_FAIL
    if (hmi_test_alloc_fail) {
        g_alloc_failed = 1;
        return NULL;
    }
#endif
    void *p = malloc(n);
    if (!p) g_alloc_failed = 1;
    return p;
}
#define STBTT_malloc(x, u) ((void)(u), stb_alloc(x))
#define STBTT_free(x, u) ((void)(u), free(x))

/* stb_truetype allocates edges in blocks of this many; small blocks fit the fragmented heap of microcontrollers. */
#ifndef STBTT_HHEAP_CHUNK
#define STBTT_HHEAP_CHUNK 64
#endif
#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-variable"
#endif
#include "third_party/stb_truetype.h"
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

/* Largest glyph bitmap side in device pixels; bigger glyphs are not drawn. */
#define GLYPH_MAX_SIDE 1024

/* ---- UTF-8 ---- */

int hmi_utf8_next(const unsigned char *s, int len, int *i) {
    unsigned char b = s[*i];
    if (b >= 0xC0 && b < 0xE0 && *i + 1 < len && (s[*i + 1] & 0xC0) == 0x80) {
        int cp = ((b & 0x1F) << 6) | (s[*i + 1] & 0x3F);
        if (cp >= 0x80) {
            *i += 2;
            return cp;
        }
    } else if (b >= 0xE0 && b < 0xF0 && *i + 2 < len && (s[*i + 1] & 0xC0) == 0x80 && (s[*i + 2] & 0xC0) == 0x80) {
        int cp = ((b & 0x0F) << 12) | ((s[*i + 1] & 0x3F) << 6) | (s[*i + 2] & 0x3F);
        if (cp >= 0x800 && (cp < 0xD800 || cp > 0xDFFF)) {
            *i += 3;
            return cp;
        }
    } else if (b >= 0xF0 && b < 0xF5 && *i + 3 < len && (s[*i + 1] & 0xC0) == 0x80 && (s[*i + 2] & 0xC0) == 0x80 &&
               (s[*i + 3] & 0xC0) == 0x80) {
        int cp = ((b & 0x07) << 18) | ((s[*i + 1] & 0x3F) << 12) | ((s[*i + 2] & 0x3F) << 6) | (s[*i + 3] & 0x3F);
        if (cp >= 0x10000 && cp <= 0x10FFFF) {
            *i += 4;
            return cp;
        }
    }
    (*i)++;
    return b;
}

int hmi_utf8_clip(const char *s, int len, int max) {
    if (len <= max) return len;
    if (max <= 0) return 0;
    int n = max;
    /* Step back over continuation bytes to the start of the sequence that crosses the limit. */
    while (n > 0 && ((unsigned char)s[n] & 0xC0) == 0x80) n--;
    return n;
}

/* ---- faces ---- */

static stbtt_fontinfo g_info[HMI_FONTS];
static uint8_t g_state[HMI_FONTS]; /* 0 not tried, 1 ready, 2 missing or invalid */

static stbtt_fontinfo *face_exact(int font) {
    if (g_state[font] == 0) {
        const unsigned char *data = hmi_font_table[font];
        int ok = 0;
        if (data) {
            int offset = stbtt_GetFontOffsetForIndex(data, 0);
            ok = offset >= 0 && stbtt_InitFont(&g_info[font], data, offset);
        }
        g_state[font] = ok ? 1 : 2;
    }
    return g_state[font] == 1 ? &g_info[font] : NULL;
}

/* The requested face, else the first face the build includes; NULL when none is. */
static stbtt_fontinfo *face(int font) {
    if (font < 0 || font >= HMI_FONTS) font = HMI_FONT_REGULAR;
    stbtt_fontinfo *f = face_exact(font);
    for (int i = 0; !f && i < HMI_FONTS; i++) f = face_exact(i);
    return f;
}

static int32_t units_per_em(const stbtt_fontinfo *f) { return ttUSHORT(f->data + f->head + 18); }

/* units * size_q4 / upem rounded to nearest and saturated; units is clamped to 32 bits so the product fits. */
static int32_t scale_units(int64_t units, int32_t size_q4, int32_t upem) {
    if (upem <= 0) return 0;
    if (units > INT32_MAX) units = INT32_MAX;
    if (units < INT32_MIN) units = INT32_MIN;
    int64_t w = units * size_q4;
    int64_t q = w >= 0 ? (w + upem / 2) / upem : -((-w + upem / 2) / upem);
    return (int32_t)(q > INT32_MAX ? INT32_MAX : q < INT32_MIN ? INT32_MIN : q);
}

int64_t hmi_text_units(int font, const char *s, int len, int32_t *upem) {
    stbtt_fontinfo *f = face(font);
    if (upem) *upem = f ? units_per_em(f) : 0;
    if (!f || !s || len <= 0) return 0;
    const unsigned char *u = (const unsigned char *)s;
    int i = 0, prev = 0;
    int64_t units = 0;
    while (i < len) {
        int cp = hmi_utf8_next(u, len, &i);
        int adv, lsb;
        stbtt_GetCodepointHMetrics(f, cp, &adv, &lsb);
        if (prev) units += stbtt_GetCodepointKernAdvance(f, prev, cp);
        units += adv;
        prev = cp;
    }
    return units;
}

int32_t hmi_font_text_width_q4(int font, const char *s, int len, int32_t size_q4) {
    int32_t upem;
    int64_t units = hmi_text_units(font, s, len, &upem);
    return scale_units(units, size_q4, upem);
}

int32_t hmi_font_line_height_q4(int font, int32_t size_q4) {
    stbtt_fontinfo *f = face(font);
    if (!f) return size_q4;
    int ascent, descent, gap;
    stbtt_GetFontVMetrics(f, &ascent, &descent, &gap);
    return scale_units((int64_t)ascent - descent, size_q4, units_per_em(f));
}

/* ---- glyph cache ----
 * Rasterized glyphs keyed by their exact parameters, so a hit is byte-identical to a fresh rasterization. The arena
 * and the table are cleared together when either fills. */
#ifndef HMI_GLYPH_CACHE_BYTES
#if defined(ARDUINO)
#define HMI_GLYPH_CACHE_BYTES (8 * 1024)
#else
#define HMI_GLYPH_CACHE_BYTES (64 * 1024)
#endif
#endif
/* Heap the cache leaves free when it is first allocated: stb_truetype allocates while it rasterizes. */
#ifndef HMI_GLYPH_CACHE_RESERVE
#define HMI_GLYPH_CACHE_RESERVE (16 * 1024)
#endif
#define GC_SLOTS 256
#define GC_PROBES 8

typedef struct {
    uint32_t key[4]; /* font and code point, then the bits of scale, x shift, y shift */
    int32_t off;     /* arena offset, -1 = empty */
} gc_entry_t;

static gc_entry_t g_gc[GC_SLOTS];
static uint8_t *g_gc_arena;
static int32_t g_gc_used, g_gc_count;
static int g_gc_disabled;

/* Scratch for glyphs the cache cannot hold. */
static unsigned char *g_scratch;
static int g_scratch_cap;

static uint32_t float_bits(float f) {
    uint32_t u;
    memcpy(&u, &f, sizeof u);
    return u;
}

static void gc_clear(void) {
    for (int i = 0; i < GC_SLOTS; i++) g_gc[i].off = -1;
    g_gc_used = 0;
    g_gc_count = 0;
}

static int gc_ready(void) {
    if (g_gc_arena) return 1;
    if (g_gc_disabled) return 0;
    void *probe = malloc(HMI_GLYPH_CACHE_BYTES + HMI_GLYPH_CACHE_RESERVE);
    if (probe) {
        free(probe);
        g_gc_arena = (uint8_t *)malloc(HMI_GLYPH_CACHE_BYTES);
    }
    if (!g_gc_arena) {
        g_gc_disabled = 1;
        return 0;
    }
    gc_clear();
    return 1;
}

#ifdef HMI_TEST_ALLOC_FAIL
void hmi_test_glyph_cache_clear(void);
void hmi_test_glyph_cache_clear(void) {
    if (g_gc_arena) gc_clear();
}
#endif

static const uint8_t *scratch_glyph(stbtt_fontinfo *f, int cp, float scale, float sx, float sy, int gw, int gh) {
    int need = gw * gh;
    if (need > g_scratch_cap) {
        unsigned char *p = (unsigned char *)realloc(g_scratch, (size_t)need);
        if (!p) return NULL;
        g_scratch = p;
        g_scratch_cap = need;
    }
    g_alloc_failed = 0;
    stbtt_MakeCodepointBitmapSubpixel(f, g_scratch, gw, gh, gw, scale, scale, sx, sy, cp);
    return g_alloc_failed ? NULL : g_scratch;
}

/* The gw x gh coverage bitmap of a glyph, from the cache or freshly rasterized; NULL when memory is short. */
static const uint8_t *glyph(stbtt_fontinfo *f, int font, int cp, float scale, float sx, float sy, int gw, int gh) {
    int need = gw * gh;
    if (need > HMI_GLYPH_CACHE_BYTES / 4 || !gc_ready()) return scratch_glyph(f, cp, scale, sx, sy, gw, gh);
    const uint32_t k[4] = {((uint32_t)font << 24) ^ (uint32_t)cp, float_bits(scale), float_bits(sx), float_bits(sy)};
    uint32_t h = (k[0] * 2654435761u) ^ (k[1] * 2246822519u) ^ (k[2] * 3266489917u) ^ (k[3] * 668265263u);
    for (int attempt = 0; attempt < 2; attempt++) {
        if (g_gc_used + need > HMI_GLYPH_CACHE_BYTES || g_gc_count >= GC_SLOTS * 3 / 4) gc_clear();
        for (int probe = 0; probe < GC_PROBES; probe++) {
            gc_entry_t *e = &g_gc[(h + (uint32_t)probe) % GC_SLOTS];
            if (e->off < 0) {
                uint8_t *bm = g_gc_arena + g_gc_used;
                g_alloc_failed = 0;
                stbtt_MakeCodepointBitmapSubpixel(f, bm, gw, gh, gw, scale, scale, sx, sy, cp);
                if (g_alloc_failed) return NULL; /* incomplete bitmap: not cached, not drawn */
                memcpy(e->key, k, sizeof k);
                e->off = g_gc_used;
                g_gc_used += need;
                g_gc_count++;
                return bm;
            }
            if (memcmp(e->key, k, sizeof k) == 0) return g_gc_arena + e->off;
        }
        gc_clear(); /* every probed slot is taken by another glyph */
    }
    return scratch_glyph(f, cp, scale, sx, sy, gw, gh);
}

/* ---- drawing ---- */

void hmi_raster_text(hmi_raster_ctx_t *c, const uint8_t *p) {
    int32_t x = hmi_rd_i32(p), y = hmi_rd_i32(p + 4), size = hmi_rd_i32(p + 8);
    int font = p[12], align = p[13];
    uint32_t argb = hmi_rd_u32(p + 14);
    int len = hmi_rd_u16(p + 18);
    const char *s = (const char *)(p + 20);
    if (size <= 0 || len == 0) return; /* stb_truetype asserts on a non-positive scale */
    stbtt_fontinfo *f = face(font);
    if (!f) return;
    float size_lu = (float)size / 16.0f;
    float scale_lu = stbtt_ScaleForMappingEmToPixels(f, size_lu); /* lu per font unit */
    float dev = (float)c->scale_q8 / 256.0f;                       /* device pixels per lu */
    float scale_px = scale_lu * dev;
    if (!(scale_px > 0.0f)) return;
    /* A face whose em box exceeds the drawable glyph size draws nothing; stopping here also keeps stb's float to
     * int box conversions in range. */
    int bx0, by0, bx1, by1;
    stbtt_GetFontBoundingBox(f, &bx0, &by0, &bx1, &by1);
    float extent = (float)((bx1 - bx0) > (by1 - by0) ? (bx1 - bx0) : (by1 - by0));
    if (!(extent * scale_px <= (float)GLYPH_MAX_SIDE)) return;
    int ascent, descent, gap;
    stbtt_GetFontVMetrics(f, &ascent, &descent, &gap);

    /* Alignment in Q4 integers, with the width the layout measured. */
    if (align != HMI_ALIGN_LEFT) {
        int32_t w = hmi_font_text_width_q4(font, s, len, size);
        x = (int32_t)((int64_t)x - (align == HMI_ALIGN_CENTER ? w / 2 : w));
    }
    float x_lu = (float)x / 16.0f, y_lu = (float)y / 16.0f;
    float base = (y_lu + (float)ascent * scale_lu) * dev + (float)c->off_y;
    /* Glyph boxes must stay well inside int range after the float to int conversions below. */
    if (!(base > -1.0e6f && base < 1.0e6f)) return;
    const unsigned char *u = (const unsigned char *)s;
    int i = 0, prev = 0;
    int32_t pen_units = 0;
    while (i < len) {
        if (hmi_raster_expired(c)) return;
        int cp = hmi_utf8_next(u, len, &i);
        if (prev) pen_units += stbtt_GetCodepointKernAdvance(f, prev, cp);
        float pen = (x_lu + (float)pen_units * scale_lu) * dev + (float)c->off_x;
        if (!(pen > -1.0e6f && pen < 1.0e6f)) break;
        int ipen = (int)pen, ibase = (int)base;
        float sx = pen - (float)ipen, sy = base - (float)ibase;
        int ix0, iy0, ix1, iy1;
        stbtt_GetCodepointBitmapBoxSubpixel(f, cp, scale_px, scale_px, sx, sy, &ix0, &iy0, &ix1, &iy1);
        int gw = ix1 - ix0, gh = iy1 - iy0;
        int ox = ipen + ix0, oy = ibase + iy0;
        int visible = !(oy + gh <= c->clip.y0 || oy >= c->clip.y1 || ox + gw <= c->clip.x0 || ox >= c->clip.x1);
        if (visible && gw > 0 && gh > 0 && gw <= GLYPH_MAX_SIDE && gh <= GLYPH_MAX_SIDE) {
            const uint8_t *bm = glyph(f, font, cp, scale_px, sx, sy, gw, gh);
            if (bm) {
                int gy0 = c->clip.y0 > oy ? c->clip.y0 - oy : 0, gy1 = c->clip.y1 < oy + gh ? c->clip.y1 - oy : gh;
                int gx0 = c->clip.x0 > ox ? c->clip.x0 - ox : 0, gx1 = c->clip.x1 < ox + gw ? c->clip.x1 - ox : gw;
                for (int gy = gy0; gy < gy1; gy++)
                    for (int gx = gx0; gx < gx1; gx++) {
                        unsigned char a = bm[gy * gw + gx];
                        if (a) hmi_raster_blend_a8(c, ox + gx, oy + gy, argb, a);
                    }
            }
        }
        int adv, lsb;
        stbtt_GetCodepointHMetrics(f, cp, &adv, &lsb);
        pen_units += adv;
        prev = cp;
    }
}
