/**
 * @file scenes.c
 * Golden scenes: each scene is recorded through the public API and rendered; the program prints one line per scene
 * with an FNV-1a 64 hash of the pixels. The same lines from every compiler and from WebAssembly prove that the
 * output is pixel-identical across targets. Banded rendering is checked against the full frame inside the program.
 *
 * Usage: scenes [dump_dir]   (dump_dir: also write <scene>.rgba files, width and height in the first 8 bytes)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"

typedef void (*scene_fn)(void);

typedef struct {
    const char *name;
    int32_t w_lu, h_lu; /* logical screen */
    int32_t scale_q8;   /* device pixels per lu */
    int32_t off_x, off_y;
    scene_fn draw;
} scene_t;

#define TOK(t) (HMI_COLOR_TOKEN | (t))

static void shapes(void) {
    hmi_clear(0xF4F4F4);
    hmi_fill_rect(10, 10, 120, 60, 0, 0x3366CC);
    hmi_fill_rect(140, 10, 120, 60, 14, 0xCC3333);
    hmi_fill_rect(270, 10, 60, 60, 200, 0x22AA44); /* radius beyond half the side: a circle */
    hmi_fill_rect(60, 40, 120, 60, 8, hmi_alpha(0x000000, 40));
    hmi_stroke_rect(10, 110, 120, 60, 0, 1, 0x111111);
    hmi_stroke_rect(140, 110, 120, 60, 12, 5, 0x6633AA);
    hmi_line(10, 190, 330, 200, 1, 0x000000);
    hmi_line(10, 210, 330, 260, 6, 0x0088CC);
    hmi_line(170, 190, 170, 300, 3, 0xAA6600);
    hmi_line(200, 230, 200, 230, 9, 0xAA0066); /* zero length: a dot */
    hmi_fill_circle(60, 270, 30, 0x008866);
    hmi_stroke_circle(140, 270, 30, 4, 0x884400);
    hmi_arc(230, 270, 30, 8, 0, 90, 0xCC0000);
    hmi_arc(230, 270, 18, 6, 120, 330, 0x0000CC);
    hmi_arc(300, 270, 26, 10, 300, 30, 0x00AA00); /* negative sweep */
    hmi_arc(300, 270, 12, 4, -45, 600, 0x555555);  /* more than one turn */
}

static void polygons(void) {
    hmi_clear(0xFFFFFF);
    /* Star (concave). */
    hmi_poly_begin(0xE07000);
    for (int i = 0; i < 10; i++) {
        int32_t r = (i % 2) ? 25 : 60;
        hmi_poly_point(80 + hmi_cos(i * 36 - 90, r), 80 + hmi_sin(i * 36 - 90, r));
    }
    hmi_poly_end();
    /* Self-overlapping pentagram: non-zero winding fills the centre. */
    hmi_poly_begin(hmi_alpha(0x2040C0, 70));
    for (int i = 0; i < 5; i++) hmi_poly_point(230 + hmi_cos(i * 144 - 90, 60), 80 + hmi_sin(i * 144 - 90, 60));
    hmi_poly_end();
    hmi_ellipse(80, 220, 60, 30, 0x30A060);
    hmi_stroke_ellipse(230, 220, 70, 40, 3, 0x803060);
    /* Stroked open and closed polylines. */
    hmi_poly_begin(0x000000);
    hmi_poly_point(10, 290);
    hmi_poly_point(60, 260);
    hmi_poly_point(110, 300);
    hmi_poly_point(160, 270);
    hmi_poly_stroke(4, 0);
    hmi_poly_begin(0xC00000);
    hmi_poly_point(200, 270);
    hmi_poly_point(300, 270);
    hmi_poly_point(250, 305);
    hmi_poly_stroke(2, 1);
}

static void text(void) {
    static const char latin[] = "Pump \xC3\x84\xC3\x96\xC3\x9C \xC3\xA7 \xE2\x82\xAC 25\xC2\xB0" "C";
    hmi_clear(0xFFFFFF);
    hmi_text(8, 4, "Hello, operator!", -1, 12, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x000000);
    hmi_text(8, 22, "AV To Wa kerning", -1, 20, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x202060);
    hmi_text(8, 50, "Bold 1234567890", -1, 24, HMI_FONT_BOLD, HMI_ALIGN_LEFT, 0x600000);
    hmi_text(170, 84, "centred", -1, 16, HMI_FONT_REGULAR, HMI_ALIGN_CENTER, 0x006000);
    hmi_text(332, 104, "right", -1, 16, HMI_FONT_BOLD, HMI_ALIGN_RIGHT, 0x000060);
    hmi_text(8, 126, latin, -1, 18, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x000000);
    hmi_text(8, 150, "tiny 7 lu", -1, 7, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x444444);
    hmi_text(8, 160, "Big", -1, 64, HMI_FONT_BOLD, HMI_ALIGN_LEFT, hmi_alpha(0x0040A0, 60));
    for (int v = 0; v < 3; v++) {
        int32_t x = 170 + v * 56;
        hmi_stroke_rect(x, 170, 50, 60, 0, 1, 0xBBBBBB);
        hmi_text_box(x, 170, 50, 60, "Box", -1, 14, HMI_FONT_REGULAR, v, v, 0x000000);
    }
    hmi_text(8, 240, "\xFF\xFE invalid \xC3", -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x880000);
    hmi_clip(8, 262, 90, 14);
    hmi_text(8, 258, "clipped text runs past", -1, 18, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0x000000);
    hmi_unclip();
}

/* A small panel drawn with theme tokens. */
static void themed_panel(int32_t x, int32_t y) {
    hmi_fill_rect(x, y, 104, 100, 6, TOK(HMI_TOKEN_SURFACE));
    hmi_fill_rect(x, y, 104, 18, 0, TOK(HMI_TOKEN_BAR));
    hmi_text(x + 4, y + 2, "Tank 1", -1, 12, HMI_FONT_BOLD, HMI_ALIGN_LEFT, TOK(HMI_TOKEN_ON_BAR));
    hmi_fill_rect(x + 8, y + 26, 30, 64, 3, TOK(HMI_TOKEN_FILL));
    hmi_fill_rect(x + 8, y + 50, 30, 40, 3, TOK(HMI_TOKEN_ACCENT));
    hmi_stroke_rect(x + 8, y + 26, 30, 64, 3, 1, TOK(HMI_TOKEN_BORDER));
    hmi_fill_circle(x + 60, y + 34, 6, TOK(HMI_TOKEN_SUCCESS));
    hmi_fill_circle(x + 76, y + 34, 6, TOK(HMI_TOKEN_WARNING));
    hmi_fill_circle(x + 92, y + 34, 6, TOK(HMI_TOKEN_DANGER));
    hmi_text(x + 48, y + 50, "62 %", -1, 14, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, TOK(HMI_TOKEN_TEXT));
    hmi_text(x + 48, y + 70, "level", -1, 11, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, TOK(HMI_TOKEN_TEXT_MUTED));
}

static void themes(void) {
    hmi_theme_copy(HMI_THEMES_BUILTIN, 2);
    hmi_theme_define(HMI_THEMES_BUILTIN, HMI_TOKEN_ACCENT, 0xFF00FF);
    hmi_clear(0x808080);
    for (int32_t t = 0; t <= HMI_THEMES_BUILTIN; t++) {
        hmi_theme_use(t);
        themed_panel(4 + (t % 3) * 112, 4 + (t / 3) * 108);
    }
    hmi_theme_use(0);
    hmi_fill_rect(4, 220, 330, 20, 0, hmi_alpha(TOK(HMI_TOKEN_ACCENT), 50));
}

static void diagram_content(void) {
    hmi_fill_rect(0, 0, 400, 200, 0, 0xE8F0F8);
    hmi_line(20, 100, 380, 100, 10, 0x6080A0);
    hmi_fill_circle(80, 100, 30, 0x2060C0);
    hmi_poly_begin(0xC04020);
    hmi_poly_point(200, 60);
    hmi_poly_point(240, 100);
    hmi_poly_point(200, 140);
    hmi_poly_point(160, 100);
    hmi_poly_end();
    hmi_text(300, 70, "V-101", -1, 16, HMI_FONT_BOLD, HMI_ALIGN_CENTER, 0x000000);
    hmi_ellipse(330, 140, 40, 20, 0x80A040);
}

static void frames(void) {
    hmi_clear(0xFFFFFF);
    /* Half scale, offset, clipped to a window. */
    hmi_frame_set(32768, 10 * 16, 10 * 16, 1, 10 * 16, 10 * 16, 160 * 16, 80 * 16);
    hmi_frame_clip();
    diagram_content();
    hmi_frame_reset();
    hmi_unclip();
    /* 1.7x, clipped tighter than the content. */
    hmi_frame_set(111411, -40 * 16, 110 * 16, 1, 10 * 16, 110 * 16, 320 * 16, 190 * 16);
    hmi_frame_clip();
    diagram_content();
    hmi_frame_reset();
    hmi_unclip();
    hmi_stroke_rect(10, 110, 320, 190, 0, 1, 0xFF0000);
}

static void extremes(void) {
    hmi_clear(0x203040);
    hmi_fill_rect(-1000000, 20, 2000000, 30, 0, 0xFFCC00);
    hmi_fill_rect(2000000000, 2000000000, 2000000000, 10, 5, 0xFF0000);
    hmi_line(-2000000000, -2000000000, 2000000000, 2000000000, 4, 0x00FFFF);
    hmi_fill_circle(170, 2000000, 1999900, 0x40A040);
    hmi_arc(170, 150, 2000000000, 2000000000, 10, 20, 0xFFFFFF);
    hmi_poly_begin(0xFF8080);
    hmi_poly_point(-100000, -100000);
    hmi_poly_point(200000, 10);
    hmi_poly_point(10, 100);
    hmi_poly_end();
    hmi_text(-2000000000, 60, "far left", -1, 16, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0xFFFFFF);
    hmi_text(20, 60, "huge", -1, 2000000000, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0xFFFFFF);
    hmi_text(20, 80, "negative size", -1, -5, HMI_FONT_REGULAR, HMI_ALIGN_LEFT, 0xFFFFFF);
    hmi_fill_rect(20, 100, -50, 30, 0, 0xFFFFFF);
    hmi_stroke_rect(20, 140, 100, 40, -5, -3, 0xFFFFFF);
    hmi_text(20, 190, "still drawn", -1, 16, HMI_FONT_BOLD, HMI_ALIGN_LEFT, 0xFFFFFF);
}

/* Every size from 7 to 40 lu with sub-pixel pen positions: the float text path, sensitive to FMA. */
static void text_sweep(void) {
    hmi_clear(0xFFFFFF);
    int32_t y = 2;
    for (int32_t size = 7; size <= 40; size++) {
        int font = size % 2 ? HMI_FONT_BOLD : HMI_FONT_REGULAR;
        hmi_text(3 + size % 5, y, "Wavy 0.5 gjq AVT \xC3\x84\xC3\xB6 1/3", -1, size, font, HMI_ALIGN_LEFT, 0x101010);
        y += size * 5 / 8 + 1;
    }
}

static void wide_poly(void) {
    hmi_clear(0xFFFFFF);
    hmi_poly_begin(0x3050A0);
    hmi_poly_point(5, 20);
    hmi_poly_point(635, 40);
    hmi_poly_point(600, 380);
    hmi_poly_point(20, 300);
    hmi_poly_end();
}

static const scene_t k_scenes[] = {
    {"shapes", 340, 310, 256, 0, 0, shapes},
    {"shapes_2x", 340, 310, 512, 0, 0, shapes},
    {"shapes_1_5x_offset", 340, 310, 384, 7, -5, shapes},
    {"polygons", 320, 310, 256, 0, 0, polygons},
    {"polygons_3x", 320, 310, 768, 0, 0, polygons},
    {"text", 340, 280, 256, 0, 0, text},
    {"text_2x", 340, 280, 512, 0, 0, text},
    {"text_1_25x", 340, 280, 320, 3, 2, text},
    {"text_sweep_1_14x", 420, 560, 293, 0, 0, text_sweep},
    {"text_sweep_1_71x", 420, 560, 437, 1, 3, text_sweep},
    {"themes", 340, 245, 256, 0, 0, themes},
    {"frames", 340, 310, 256, 0, 0, frames},
    {"extremes", 340, 220, 256, 0, 0, extremes},
    {"wide_poly_2x", 640, 400, 512, 0, 0, wide_poly},
};

static uint64_t fnv64(const uint8_t *p, size_t n) {
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < n; i++) {
        h ^= p[i];
        h *= 1099511628211ULL;
    }
    return h;
}

/* Renders the list in bands of band_h rows into out. */
static int render_bands(const uint8_t *dl, size_t len, uint8_t *out, int w, int h, int band_h, const scene_t *s) {
    for (int y = 0; y < h; y += band_h) {
        int bh = y + band_h <= h ? band_h : h - y;
        int rc = hmi_raster_render(dl, len, out + (size_t)y * (size_t)w * 4, w, h, w, y, bh, s->scale_q8, s->off_x,
                                   s->off_y);
        if (rc != HMI_RASTER_OK) return rc;
    }
    return HMI_RASTER_OK;
}

static int write_dump(const char *dir, const char *name, const uint8_t *px, int w, int h) {
    char path[512];
    snprintf(path, sizeof path, "%s/%s.rgba", dir, name);
    FILE *f = fopen(path, "wb");
    if (!f) return 0;
    uint8_t head[8] = {(uint8_t)w, (uint8_t)(w >> 8), (uint8_t)(w >> 16), (uint8_t)(w >> 24),
                       (uint8_t)h, (uint8_t)(h >> 8), (uint8_t)(h >> 16), (uint8_t)(h >> 24)};
    int ok = fwrite(head, 1, 8, f) == 8 && fwrite(px, 4, (size_t)w * (size_t)h, f) == (size_t)w * (size_t)h;
    return fclose(f) == 0 && ok;
}

int main(int argc, char **argv) {
    const char *dump = argc > 1 ? argv[1] : NULL;
    int failed = 0;
    static const int k_bands[] = {1, 7, 16, 64};
    for (size_t i = 0; i < sizeof k_scenes / sizeof k_scenes[0]; i++) {
        const scene_t *s = &k_scenes[i];
        hmi_core_init(s->w_lu, s->h_lu);
        hmi_theme_use(0);
        hmi_frame_begin();
        s->draw();
        size_t len;
        const uint8_t *dl = hmi_frame_end(&len);
        if (hmi_frame_status() != 0) {
            fprintf(stderr, "%s: frame status %u\n", s->name, (unsigned)hmi_frame_status());
            failed = 1;
        }
        int w = (int)(((int64_t)s->w_lu * s->scale_q8 + 255) / 256), h = (int)(((int64_t)s->h_lu * s->scale_q8 + 255) / 256);
        size_t bytes = (size_t)w * (size_t)h * 4;
        uint8_t *full = (uint8_t *)calloc(bytes, 1), *banded = (uint8_t *)calloc(bytes, 1);
        if (!full || !banded) {
            fprintf(stderr, "out of memory\n");
            return 2;
        }
        int rc = render_bands(dl, len, full, w, h, h, s);
        if (rc != HMI_RASTER_OK) {
            fprintf(stderr, "%s: render failed %d\n", s->name, rc);
            failed = 1;
        }
        for (size_t b = 0; b < sizeof k_bands / sizeof k_bands[0]; b++) {
            memset(banded, 0, bytes);
            if (render_bands(dl, len, banded, w, h, k_bands[b], s) != HMI_RASTER_OK || memcmp(full, banded, bytes) != 0) {
                fprintf(stderr, "%s: bands of %d rows differ from the full frame\n", s->name, k_bands[b]);
                failed = 1;
            }
        }
        printf("%s %dx%d %016llx\n", s->name, w, h, (unsigned long long)fnv64(full, bytes));
        if (dump && !write_dump(dump, s->name, full, w, h)) {
            fprintf(stderr, "%s: cannot write dump\n", s->name);
            failed = 1;
        }
        free(full);
        free(banded);
    }
    return failed;
}
