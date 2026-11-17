/* HMI core: predefined and project themes. */
#include "hmi_internal.h"

/* Token values by theme, indexed by hmi_token (index 0 unused). */
static const uint32_t k_builtin[HMI_THEMES_BUILTIN][HMI_TOKENS] = {
    /* 0 Autonomy */
    {0, 0xF7F8FA, 0xFFFFFF, 0x121316, 0x5E6275, 0xC8D0D9, 0xDDE2E8, 0x0464FB, 0xFFFFFF, 0x16A34A, 0xF59E0B, 0xDC2626,
     0x011E4B, 0xB4D0FE},
    /* 1 Light */
    {0, 0xFFFFFF, 0xFFFFFF, 0x141414, 0x5A5A5A, 0x969696, 0xEEEEEE, 0xFF8C00, 0xFFFFFF, 0x008200, 0xC86400, 0xC80000,
     0x282828, 0xEBEBEB},
    /* 2 Dark */
    {0, 0x14161A, 0x282C32, 0xDCDCDC, 0xA5AAB4, 0x6E737D, 0x282C32, 0xFFAA28, 0x14161A, 0x78D278, 0xFFB45A, 0xFF5A5A,
     0x08090B, 0xC8CDD7},
    /* 3 Classic */
    {0, 0xC6D2A8, 0xC6D2A8, 0x000000, 0x404040, 0x848484, 0xB4BF98, 0xFFA400, 0xFFFFFF, 0x008C00, 0xE67800, 0xFF0000,
     0x212421, 0xC6C6C6},
    /* 4 Ocean */
    {0, 0x122634, 0x203C4E, 0xD7E6F0, 0xA0BECD, 0x64828C, 0x203C4E, 0x00C8C8, 0x0A1E28, 0x78D7A0, 0xFFBE6E, 0xFF6E6E,
     0x081620, 0xC8E1EB},
};

/* Project themes; one never defined resolves like theme 0. */
static uint32_t g_project[HMI_THEMES_MAX - HMI_THEMES_BUILTIN][HMI_TOKENS];
static uint8_t g_project_set[HMI_THEMES_MAX - HMI_THEMES_BUILTIN];

static int is_project(int32_t theme) { return theme >= HMI_THEMES_BUILTIN && theme < HMI_THEMES_MAX; }

void hmi_theme_copy(int32_t theme, int32_t base) {
    if (!is_project(theme) || base < 0 || base >= HMI_THEMES_BUILTIN) return;
    int i = theme - HMI_THEMES_BUILTIN;
    for (int k = 0; k < HMI_TOKENS; k++) g_project[i][k] = k_builtin[base][k];
    g_project_set[i] = 1;
}

void hmi_theme_define(int32_t theme, int32_t token, uint32_t rgb) {
    if (!is_project(theme) || token <= 0 || token >= HMI_TOKENS) return;
    int i = theme - HMI_THEMES_BUILTIN;
    if (!g_project_set[i]) hmi_theme_copy(theme, 0);
    g_project[i][token] = rgb & 0xFFFFFFu;
}

static uint32_t token_rgb(int32_t theme, uint32_t token) {
    if (token == 0 || token >= HMI_TOKENS) return 0;
    if (is_project(theme) && g_project_set[theme - HMI_THEMES_BUILTIN])
        return g_project[theme - HMI_THEMES_BUILTIN][token];
    if (theme < 0 || theme >= HMI_THEMES_BUILTIN) theme = 0;
    return k_builtin[theme][token];
}

uint32_t hmi_color_resolve(uint32_t color, int32_t theme) {
    uint32_t rgb = (color & HMI_COLOR_TOKEN) ? token_rgb(theme, color & 0xFFu) : (color & 0xFFFFFFu);
    uint32_t transparency = (color >> 24) & 0x7Fu;
    if (transparency > 100u) transparency = 100u;
    uint32_t a = 255u - (transparency * 255u + 50u) / 100u;
    return (a << 24) | rgb;
}

uint32_t hmi_alpha(uint32_t color, int32_t opacity_pct) {
    if (opacity_pct < 0) opacity_pct = 0;
    if (opacity_pct > 100) opacity_pct = 100;
    return (color & (HMI_COLOR_TOKEN | 0xFFFFFFu)) | ((uint32_t)(100 - opacity_pct) << 24);
}
