/* HMI core: integer trigonometry, the ellipse table and number formatting. */
#include <stdio.h>
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

int hmi_format_real(char *buf, int size, float v, int d) {
    static const uint32_t k_pow10[7] = {1u, 10u, 100u, 1000u, 10000u, 100000u, 1000000u};
    if (!buf || size < 2) {
        if (buf && size == 1) buf[0] = 0;
        return 0;
    }
    if (d < 0) d = 0;
    if (d > 6) d = 6;
    uint32_t bits;
    memcpy(&bits, &v, sizeof bits);
    int neg = (bits >> 31) != 0; /* sign bit, so -0.0 prints "-0" as printf does */
    float a = neg ? -v : v;
    /* NaN, infinities, |v| >= 2^32 and magnitudes below 2^-16 (not exact in Q40) go through printf. */
    if (!(a < 4294967296.0f) || (a != 0.0f && a < 1.0f / 65536.0f)) {
        int n = snprintf(buf, (size_t)size, "%.*f", d, (double)v);
        if (n < 0) {
            buf[0] = 0;
            return 0;
        }
        return n < size ? n : size - 1;
    }
    uint32_t ip = (uint32_t)a;
    float f = a - (float)ip;                         /* exact */
    uint64_t fq = (uint64_t)(f * 1099511627776.0f); /* f in Q40, exact for a >= 2^-16 */
    uint64_t prod = fq * k_pow10[d];
    uint64_t frac = prod >> 40, rem = prod & ((1ull << 40) - 1), half = 1ull << 39;
    uint64_t last = d > 0 ? frac : ip;
    if (rem > half || (rem == half && (last & 1u))) frac++; /* round half to even on the exact value */
    if (frac >= k_pow10[d]) {
        frac -= k_pow10[d];
        ip++;
    }
    char tmp[32];
    int len = 0;
    for (int i = 0; i < d; i++) {
        tmp[len++] = (char)('0' + (int)(frac % 10u));
        frac /= 10u;
    }
    if (d > 0) tmp[len++] = '.';
    uint64_t n = ip;
    do {
        tmp[len++] = (char)('0' + (int)(n % 10u));
        n /= 10u;
    } while (n > 0);
    if (neg) tmp[len++] = '-'; /* as printf: -0.001 with 2 decimals is "-0.00" */
    int out = 0;
    while (len > 0 && out < size - 1) buf[out++] = tmp[--len];
    buf[out] = 0;
    return out;
}
