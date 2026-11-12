/* HMI core: integer trigonometry, the ellipse table and number formatting. */
#include <string.h>

#include "hmi_internal.h"

/* sin(0..90 degrees) in Q15 (32767 = 1). */
static const int16_t k_sin90[91] = {
    0, 572, 1144, 1715, 2286, 2856, 3425, 3993, 4560, 5126,
    5690, 6252, 6813, 7371, 7927, 8481, 9032, 9580, 10126, 10668,
    11207, 11743, 12275, 12803, 13328, 13848, 14364, 14876, 15383, 15886,
    16383, 16876, 17364, 17846, 18323, 18794, 19260, 19720, 20173, 20621,
    21062, 21497, 21925, 22347, 22762, 23170, 23571, 23964, 24351, 24730,
    25101, 25465, 25821, 26169, 26509, 26841, 27165, 27481, 27788, 28087,
    28377, 28659, 28932, 29196, 29451, 29697, 29934, 30162, 30381, 30591,
    30791, 30982, 31163, 31335, 31498, 31650, 31794, 31927, 32051, 32165,
    32269, 32364, 32448, 32523, 32587, 32642, 32687, 32722, 32747, 32762,
    32767,
};

int32_t hmi_sin(int32_t deg, int32_t amp) {
    int32_t d = deg % 360;
    if (d < 0) d += 360;
    int32_t q;
    if (d <= 90)
        q = k_sin90[d];
    else if (d <= 180)
        q = k_sin90[180 - d];
    else if (d <= 270)
        q = -k_sin90[d - 180];
    else
        q = -k_sin90[360 - d];
    int64_t v = (int64_t)amp * q;
    return (int32_t)(v >= 0 ? (v + 16383) / 32767 : -((-v + 16383) / 32767));
}

int32_t hmi_cos(int32_t deg, int32_t amp) { return hmi_sin((int32_t)(((int64_t)deg + 90) % 360), amp); }

/* Unit circle in 32 steps, Q14, clockwise in screen coordinates (y grows down). */
const int16_t hmi_circle32[32][2] = {
    {16384, 0},
    {16069, 3196},
    {15137, 6270},
    {13623, 9102},
    {11585, 11585},
    {9102, 13623},
    {6270, 15137},
    {3196, 16069},
    {0, 16384},
    {-3196, 16069},
    {-6270, 15137},
    {-9102, 13623},
    {-11585, 11585},
    {-13623, 9102},
    {-15137, 6270},
    {-16069, 3196},
    {-16384, 0},
    {-16069, -3196},
    {-15137, -6270},
    {-13623, -9102},
    {-11585, -11585},
    {-9102, -13623},
    {-6270, -15137},
    {-3196, -16069},
    {0, -16384},
    {3196, -16069},
    {6270, -15137},
    {9102, -13623},
    {11585, -11585},
    {13623, -9102},
    {15137, -6270},
    {16069, -3196},
};

int hmi_format_int(char *buf, int size, int32_t v) {
    if (!buf || size < 1) return 0;
    char tmp[12];
    int len = 0;
    uint32_t n = v < 0 ? (uint32_t)0 - (uint32_t)v : (uint32_t)v;
    do {
        tmp[len++] = (char)('0' + (int)(n % 10u));
        n /= 10u;
    } while (n > 0);
    if (v < 0) tmp[len++] = '-';
    int out = 0;
    while (len > 0 && out < size - 1) buf[out++] = tmp[--len];
    buf[out] = 0;
    return out;
}

/* Prints the magnitude in limbs (little-endian 32-bit words) in decimal, most significant digit first. */
static int put_decimal(char *tmp, uint32_t limbs[4]) {
    int len = 0;
    char rev[48];
    do {
        uint64_t rem = 0;
        for (int i = 3; i >= 0; i--) {
            uint64_t cur = (rem << 32) | limbs[i];
            limbs[i] = (uint32_t)(cur / 10u);
            rem = cur % 10u;
        }
        rev[len++] = (char)('0' + (int)rem);
    } while (limbs[0] | limbs[1] | limbs[2] | limbs[3]);
    for (int i = 0; i < len; i++) tmp[i] = rev[len - 1 - i];
    return len;
}

static int emit(char *buf, int size, const char *s, int n) {
    int out = n < size - 1 ? n : size - 1;
    memcpy(buf, s, (size_t)out);
    buf[out] = 0;
    return out;
}

int hmi_format_real(char *buf, int size, float v, int d) {
    static const uint32_t k_pow10[7] = {1u, 10u, 100u, 1000u, 10000u, 100000u, 1000000u};
    if (!buf || size < 1) return 0;
    if (d < 0) d = 0;
    if (d > 6) d = 6;
    uint32_t bits;
    memcpy(&bits, &v, sizeof bits);
    int neg = (bits >> 31) != 0; /* sign bit, so -0.0 prints "-0" as printf does */
    uint32_t exp = (bits >> 23) & 0xFFu, mant = bits & 0x7FFFFFu;
    if (exp == 0xFFu) return mant ? emit(buf, size, "NaN", 3) : neg ? emit(buf, size, "-Inf", 4) : emit(buf, size, "Inf", 3);
    /* v = m * 2^k exactly, m < 2^24. */
    uint32_t m = exp ? (mant | 0x800000u) : mant;
    int k = exp ? (int)exp - 150 : -149;
    uint32_t ip[4] = {0, 0, 0, 0}; /* integer part, up to 128 bits */
    uint64_t frac = 0;              /* fraction scaled by 10^d, rounded half to even */
    if (k >= 0) {
        /* m << k across the limbs (k <= 104). */
        int word = k / 32, shift = k % 32;
        ip[word] = m << shift;
        if (shift && word + 1 < 4) ip[word + 1] = m >> (32 - shift);
    } else {
        int s = -k;
        uint32_t whole = s < 32 ? m >> s : 0;
        uint64_t rest = s < 32 ? (m & ((1u << s) - 1u)) : m; /* fraction bits, value rest / 2^s */
        ip[0] = whole;
        uint64_t num = rest * k_pow10[d];                    /* < 2^44 */
        uint64_t q = s < 64 ? num >> s : 0;
        uint64_t rem = s < 64 ? num & ((((uint64_t)1) << s) - 1u) : num;
        /* half = 2^(s-1); s >= 64 leaves num < half. */
        if (s < 64) {
            uint64_t half = ((uint64_t)1) << (s - 1);
            uint64_t last = d > 0 ? q : whole;
            if (rem > half || (rem == half && (last & 1u))) q++;
        }
        if (q >= k_pow10[d]) {
            q -= k_pow10[d];
            ip[0]++; /* whole < 2^24: no carry into the next limb */
        }
        frac = q;
    }
    char tmp[64];
    int len = 0;
    if (neg) tmp[len++] = '-';
    len += put_decimal(tmp + len, ip);
    if (d > 0) {
        tmp[len++] = '.';
        for (int i = d - 1; i >= 0; i--) {
            tmp[len + i] = (char)('0' + (int)(frac % 10u));
            frac /= 10u;
        }
        len += d;
    }
    return emit(buf, size, tmp, len);
}
