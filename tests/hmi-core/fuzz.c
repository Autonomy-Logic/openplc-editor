/**
 * @file fuzz.c
 * Fuzzing of the HMI core with assertions on, meant for AddressSanitizer and UndefinedBehaviorSanitizer builds.
 * Two inputs: raw bytes taken as a display list body (malformed lists), and random primitive calls with extreme
 * arguments recorded through the API (saturation paths), both rendered at random densities, offsets and bands.
 *
 * libFuzzer: build with -DHMI_LIBFUZZER and -fsanitize=fuzzer. Standalone: fuzz <iterations> [seed].
 */
#undef NDEBUG
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_internal.h"

#define W 96
#define H 64

static uint8_t g_px[W * H * 4];

/* Little-endian reader over the fuzz input; reads past the end return zeros. */
typedef struct {
    const uint8_t *p;
    size_t n, i;
} reader_t;

static uint32_t take(reader_t *r, int bytes) {
    uint32_t v = 0;
    for (int k = 0; k < bytes; k++) v |= (uint32_t)(r->i < r->n ? r->p[r->i++] : 0) << (8 * k);
    return v;
}

/* Values that reach the interesting edges: small, screen-sized, negative, extreme. */
static int32_t value(reader_t *r) {
    uint32_t sel = take(r, 1) % 8, v = take(r, 4);
    switch (sel) {
    case 0: return (int32_t)(v % 64);
    case 1: return (int32_t)(v % 400) - 100;
    case 2: return -(int32_t)(v % 1000);
    case 3: return (int32_t)v;
    case 4: return INT32_MAX - (int32_t)(v % 4);
    case 5: return INT32_MIN + (int32_t)(v % 4);
    case 6: return (int32_t)(v % 5000) - 2500;
    default: return 0;
    }
}

static void render_all(const uint8_t *dl, size_t len, reader_t *r) {
    static const int32_t k_scales[] = {256, 128, 512, 1, 65536, 300};
    int32_t scale = k_scales[take(r, 1) % 6];
    int32_t ox = (int32_t)(take(r, 1) % 32) - 16, oy = (int32_t)(take(r, 1) % 32) - 16;
    int band_h = 1 + (int)(take(r, 1) % H);
    for (int y = 0; y < H; y += band_h) {
        int bh = y + band_h <= H ? band_h : H - y;
        int rc = hmi_raster_render(dl, len, g_px + (size_t)y * W * 4, W, H, W, y, bh, scale, ox, oy);
        HMI_ASSERT(rc == HMI_RASTER_OK || rc == HMI_RASTER_MALFORMED || rc == HMI_RASTER_BAD_LIST);
    }
    uint32_t hashes[8];
    int rc = hmi_raster_band_hashes(dl, len, W, H, 8, scale, ox, oy, hashes, 8);
    HMI_ASSERT(rc == HMI_RASTER_OK || rc == HMI_RASTER_MALFORMED || rc == HMI_RASTER_BAD_LIST);
}

/* Raw bytes as the command stream of a list with a plausible header. */
static void fuzz_raw(const uint8_t *data, size_t size) {
    if (size < 8) return;
    reader_t r = {data, 8, 0};
    size_t body = size - 8;
    uint8_t *dl = (uint8_t *)malloc(HMI_DL_HEADER_SIZE + body + 1);
    if (!dl) return;
    hmi_wr_u32(dl, HMI_DL_MAGIC);
    dl[4] = (uint8_t)HMI_DL_VERSION;
    dl[5] = 0;
    dl[6] = dl[7] = 0;
    hmi_wr_u32(dl + 8, W);
    hmi_wr_u32(dl + 12, H);
    hmi_wr_u32(dl + 16, take(&r, 2) % 64);
    memcpy(dl + HMI_DL_HEADER_SIZE, data + 8, body);
    render_all(dl, HMI_DL_HEADER_SIZE + body, &r);
    free(dl);
}

static const char k_texts[][24] = {"", "A", "Hello", "\xC3\xA9\xE2\x82\xAC", "\xFF\xC3", "AV To", "12345.678"};

/* Random primitive calls through the public API. */
static void fuzz_api(const uint8_t *data, size_t size) {
    reader_t r = {data, size, 0};
    hmi_core_init(W, H);
    hmi_theme_use((int32_t)(take(&r, 1) % 20) - 2);
    hmi_frame_begin();
    while (r.i < r.n) {
        uint32_t c = HMI_COLOR_TOKEN * (take(&r, 1) & 1) | take(&r, 4);
        switch (take(&r, 1) % 19) {
        case 0: hmi_clear(c); break;
        case 1: hmi_fill_rect(value(&r), value(&r), value(&r), value(&r), value(&r), c); break;
        case 2: hmi_stroke_rect(value(&r), value(&r), value(&r), value(&r), value(&r), value(&r), c); break;
        case 3: hmi_line(value(&r), value(&r), value(&r), value(&r), value(&r), c); break;
        case 4: hmi_fill_circle(value(&r), value(&r), value(&r), c); break;
        case 5: hmi_arc(value(&r), value(&r), value(&r), value(&r), value(&r), value(&r), c); break;
        case 6: hmi_ellipse(value(&r), value(&r), value(&r), value(&r), c); break;
        case 7: hmi_stroke_ellipse(value(&r), value(&r), value(&r), value(&r), value(&r), c); break;
        case 8: {
            const char *s = k_texts[take(&r, 1) % 7];
            hmi_text(value(&r), value(&r), s, -1, value(&r), (int)(take(&r, 1) % 4) - 1, (int)(take(&r, 1) % 4), c);
            break;
        }
        case 9: {
            const char *s = k_texts[take(&r, 1) % 7];
            hmi_text_box(value(&r), value(&r), value(&r), value(&r), s, -1, value(&r), (int)(take(&r, 1) % 3),
                         (int)(take(&r, 1) % 4), (int)(take(&r, 1) % 4), c);
            break;
        }
        case 10: hmi_clip(value(&r), value(&r), value(&r), value(&r)); break;
        case 11: hmi_unclip(); break;
        case 12: {
            int n = (int)(take(&r, 1) % 70);
            hmi_poly_begin(c);
            for (int i = 0; i < n; i++) hmi_poly_point(value(&r), value(&r));
            if (take(&r, 1) & 1)
                hmi_poly_end();
            else
                hmi_poly_stroke(value(&r), (int)(take(&r, 1) & 1));
            break;
        }
        case 13:
            hmi_frame_set(value(&r), value(&r), value(&r), (int)(take(&r, 1) & 1), value(&r), value(&r), value(&r),
                          value(&r));
            break;
        case 14: hmi_frame_clip(); break;
        case 15: hmi_frame_reset(); break;
        case 16: hmi_elem_bounds_in(value(&r), value(&r), value(&r), value(&r), value(&r), (int)(take(&r, 1) & 1)); break;
        case 17: hmi_input_pointer((int)(take(&r, 1) % 4), value(&r), value(&r)); break;
        default: {
            char buf[48];
            hmi_format_real(buf, (int)(take(&r, 1) % 48), (float)value(&r) / 7.0f, (int)(take(&r, 1) % 9) - 1);
            hmi_format_int(buf, (int)(take(&r, 1) % 16), value(&r));
            (void)hmi_text_width(k_texts[take(&r, 1) % 7], -1, value(&r), (int)(take(&r, 1) % 3));
            (void)hmi_ptr_x();
            (void)hmi_ptr_y();
            break;
        }
        }
    }
    size_t len;
    const uint8_t *dl = hmi_frame_end(&len);
    HMI_ASSERT(len <= HMI_DL_CAPACITY);
    reader_t rr = {data, size, 0};
    render_all(dl, len, &rr);
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    if (size == 0) return 0;
    if (data[0] & 1)
        fuzz_raw(data + 1, size - 1);
    else
        fuzz_api(data + 1, size - 1);
    return 0;
}

#ifndef HMI_LIBFUZZER
static uint64_t g_state;
static uint32_t next_random(void) {
    g_state ^= g_state << 13;
    g_state ^= g_state >> 7;
    g_state ^= g_state << 17;
    return (uint32_t)(g_state >> 32);
}

int main(int argc, char **argv) {
    long iterations = argc > 1 ? strtol(argv[1], NULL, 10) : 10000;
    g_state = argc > 2 ? strtoull(argv[2], NULL, 10) : 0x9E3779B97F4A7C15ull;
    if (g_state == 0) g_state = 1;
    static uint8_t buf[2048];
    for (long it = 0; it < iterations; it++) {
        size_t n = 1 + next_random() % sizeof buf;
        for (size_t i = 0; i < n; i++) buf[i] = (uint8_t)next_random();
        /* Half the raw inputs start from a valid command so they get past the first opcode. */
        if ((buf[0] & 1) && n > 10 && (next_random() & 1)) buf[9] = (uint8_t)(1 + next_random() % 10);
        LLVMFuzzerTestOneInput(buf, n);
    }
    printf("fuzz: %ld inputs\n", iterations);
    return 0;
}
#endif
