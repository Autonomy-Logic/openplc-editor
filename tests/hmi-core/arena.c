/*
 * Sweeps every glyph the font table maps, in both faces, at every size from 4 to 403 screen units, through the
 * rasterizer of a HMI_STATIC_MEMORY build, and prints the most stb_truetype arena bytes one glyph used. run.mjs
 * compares it with HMI_STB_ARENA_BYTES of the variant.
 */
#include <stdio.h>
#include <stdlib.h>

#include "hmi_core.h"
#include "hmi_internal.h"

#define STBTT_STATIC
#define STB_TRUETYPE_IMPLEMENTATION
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-variable"
#endif
#include "third_party/stb_truetype.h"
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

extern size_t hmi_test_stb_peak;
void hmi_test_glyph_cache_clear(void);

#define SCREEN_W 1280
#define SCREEN_H 1024
#define CHUNK 24

static uint8_t g_px[SCREEN_W * SCREEN_H * 4];
static int g_cps[0x10000];

static int utf8(int cp, char *out) {
    if (cp < 0x80) {
        out[0] = (char)cp;
        return 1;
    }
    if (cp < 0x800) {
        out[0] = (char)(0xC0 | (cp >> 6));
        out[1] = (char)(0x80 | (cp & 0x3F));
        return 2;
    }
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
}

int main(void) {
    size_t worst = 0;
    hmi_core_init(SCREEN_W, SCREEN_H);
    for (int face = 0; face < HMI_FONTS; face++) {
        stbtt_fontinfo info;
        const unsigned char *data = hmi_font_table[face];
        if (!data || !stbtt_InitFont(&info, data, stbtt_GetFontOffsetForIndex(data, 0))) {
            fprintf(stderr, "face %d does not load\n", face);
            return 1;
        }
        int n = 0;
        for (int cp = 0x20; cp < 0x10000; cp++)
            if ((cp < 0xD800 || cp > 0xDFFF) && stbtt_FindGlyphIndex(&info, cp) != 0) g_cps[n++] = cp;
        for (int size = 4; size < 404; size++) {
            for (int i = 0; i < n; i += CHUNK) {
                char text[CHUNK * 3];
                int len = 0;
                for (int k = i; k < i + CHUNK && k < n; k++) len += utf8(g_cps[k], text + len);
                hmi_test_glyph_cache_clear();
                hmi_frame_begin();
                hmi_text(0, 0, text, len, size, face, HMI_ALIGN_LEFT, 0xFF000000u);
                size_t dl_len = 0;
                const uint8_t *dl = hmi_frame_end(&dl_len);
                if (hmi_raster_render(dl, dl_len, g_px, SCREEN_W, SCREEN_H, SCREEN_W, 0, SCREEN_H, 256, 0, 0) !=
                    HMI_RASTER_OK) {
                    fprintf(stderr, "face %d size %d: render failed\n", face, size);
                    return 1;
                }
            }
        }
        if (hmi_test_stb_peak > worst) worst = hmi_test_stb_peak;
    }
    printf("%zu\n", worst);
    return 0;
}
