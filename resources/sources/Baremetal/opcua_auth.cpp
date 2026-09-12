/*
opcua_auth.cpp - PBKDF2-HMAC-SHA256 password verification
Copyright (C) 2026 Autonomy Logic

See opcua_auth.h for why the iteration count is the interesting part.
*/

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <Arduino.h>
#include <string.h>

#include "opcua_auth.h"
#include "opcua_log.h"

/** Most iterations this target will actually execute.
 *
 *  Deliberately NOT the same knob as the VPP's `kdfIterations`: that says what
 *  the editor SHOULD hash with, this says what the runtime will tolerate being
 *  asked to do inside a scan cycle. They coincide when the project is built
 *  for this target and diverge when a hash was produced elsewhere. */
#ifndef OPCUA_KDF_MAX_ITERATIONS
#define OPCUA_KDF_MAX_ITERATIONS 20000u
#endif

namespace {

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4). Straightforward, unrolled only where it is free.
// ---------------------------------------------------------------------------

struct Sha256
{
    uint32_t state[8];
    uint64_t bitlen;
    uint8_t  buf[64];
    uint8_t  buflen;
};

const uint32_t K[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u };

inline uint32_t ror(uint32_t x, uint32_t n) { return (x >> n) | (x << (32 - n)); }

void sha256_block(Sha256* c, const uint8_t* p)
{
    uint32_t w[64];
    for (uint8_t i = 0; i < 16; i++)
        w[i] = ((uint32_t)p[i*4] << 24) | ((uint32_t)p[i*4+1] << 16) |
               ((uint32_t)p[i*4+2] << 8) | (uint32_t)p[i*4+3];
    for (uint8_t i = 16; i < 64; i++)
    {
        const uint32_t s0 = ror(w[i-15],7) ^ ror(w[i-15],18) ^ (w[i-15] >> 3);
        const uint32_t s1 = ror(w[i-2],17) ^ ror(w[i-2],19)  ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    uint32_t a=c->state[0],b=c->state[1],cc=c->state[2],d=c->state[3];
    uint32_t e=c->state[4],f=c->state[5],g=c->state[6],h=c->state[7];
    for (uint8_t i = 0; i < 64; i++)
    {
        const uint32_t S1 = ror(e,6) ^ ror(e,11) ^ ror(e,25);
        const uint32_t ch = (e & f) ^ ((~e) & g);
        const uint32_t t1 = h + S1 + ch + K[i] + w[i];
        const uint32_t S0 = ror(a,2) ^ ror(a,13) ^ ror(a,22);
        const uint32_t mj = (a & b) ^ (a & cc) ^ (b & cc);
        const uint32_t t2 = S0 + mj;
        h=g; g=f; f=e; e=d+t1; d=cc; cc=b; b=a; a=t1+t2;
    }
    c->state[0]+=a; c->state[1]+=b; c->state[2]+=cc; c->state[3]+=d;
    c->state[4]+=e; c->state[5]+=f; c->state[6]+=g; c->state[7]+=h;
}

void sha256_init(Sha256* c)
{
    c->state[0]=0x6a09e667u; c->state[1]=0xbb67ae85u; c->state[2]=0x3c6ef372u; c->state[3]=0xa54ff53au;
    c->state[4]=0x510e527fu; c->state[5]=0x9b05688cu; c->state[6]=0x1f83d9abu; c->state[7]=0x5be0cd19u;
    c->bitlen=0; c->buflen=0;
}

void sha256_update(Sha256* c, const uint8_t* d, size_t n)
{
    for (size_t i = 0; i < n; i++)
    {
        c->buf[c->buflen++] = d[i];
        if (c->buflen == 64) { sha256_block(c, c->buf); c->bitlen += 512; c->buflen = 0; }
    }
}

void sha256_final(Sha256* c, uint8_t out[32])
{
    uint64_t bits = c->bitlen + (uint64_t)c->buflen * 8;
    uint8_t i = c->buflen;
    c->buf[i++] = 0x80;
    if (i > 56) { while (i < 64) c->buf[i++] = 0; sha256_block(c, c->buf); i = 0; }
    while (i < 56) c->buf[i++] = 0;
    for (int8_t k = 7; k >= 0; k--) c->buf[i++] = (uint8_t)(bits >> (k*8));
    sha256_block(c, c->buf);
    for (uint8_t k = 0; k < 8; k++)
    {
        out[k*4]   = (uint8_t)(c->state[k] >> 24);
        out[k*4+1] = (uint8_t)(c->state[k] >> 16);
        out[k*4+2] = (uint8_t)(c->state[k] >> 8);
        out[k*4+3] = (uint8_t)(c->state[k]);
    }
}

// ---------------------------------------------------------------------------
// HMAC-SHA256, with the key schedule hoisted out of the PBKDF2 loop.
//
// PBKDF2 repeats HMAC with the SAME key tens of thousands of times, so the
// inner and outer padded-key states are computed once and copied per
// iteration. That is the single biggest win available without hardware: it
// removes two block compressions per iteration out of four.
// ---------------------------------------------------------------------------

struct HmacKey { Sha256 inner; Sha256 outer; };

void hmac_key_init(HmacKey* hk, const uint8_t* key, size_t keylen)
{
    uint8_t k[64];
    memset(k, 0, sizeof(k));
    if (keylen > 64)
    {
        Sha256 t; sha256_init(&t); sha256_update(&t, key, keylen); sha256_final(&t, k);
    }
    else memcpy(k, key, keylen);

    uint8_t pad[64];
    for (uint8_t i = 0; i < 64; i++) pad[i] = k[i] ^ 0x36;
    sha256_init(&hk->inner); sha256_update(&hk->inner, pad, 64);
    for (uint8_t i = 0; i < 64; i++) pad[i] = k[i] ^ 0x5c;
    sha256_init(&hk->outer); sha256_update(&hk->outer, pad, 64);
}

void hmac_with(const HmacKey* hk, const uint8_t* msg, size_t len, uint8_t out[32])
{
    Sha256 c = hk->inner;
    sha256_update(&c, msg, len);
    uint8_t ih[32]; sha256_final(&c, ih);
    Sha256 o = hk->outer;
    sha256_update(&o, ih, 32);
    sha256_final(&o, out);
}

// ---------------------------------------------------------------------------
// base64 decode (no padding assumptions beyond '=')
// ---------------------------------------------------------------------------

int8_t b64val(char ch)
{
    if (ch >= 'A' && ch <= 'Z') return (int8_t)(ch - 'A');
    if (ch >= 'a' && ch <= 'z') return (int8_t)(ch - 'a' + 26);
    if (ch >= '0' && ch <= '9') return (int8_t)(ch - '0' + 52);
    if (ch == '+') return 62;
    if (ch == '/') return 63;
    return -1;
}

size_t b64decode(const char* s, size_t slen, uint8_t* out, size_t outcap)
{
    uint32_t acc = 0; uint8_t bits = 0; size_t n = 0;
    for (size_t i = 0; i < slen; i++)
    {
        const int8_t v = b64val(s[i]);
        if (v < 0) continue;            // '=' and any stray whitespace
        acc = (acc << 6) | (uint32_t)v; bits += 6;
        if (bits >= 8)
        {
            bits -= 8;
            if (n < outcap) out[n++] = (uint8_t)(acc >> bits);
        }
    }
    return n;
}

uint32_t g_last_us = 0;

} // namespace

bool opcua_auth_verify(const char* password, size_t password_len, const char* stored)
{
    const unsigned long t0 = micros();
    bool ok = false;

    // pbkdf2:sha256:<iters>$<salt-b64>$<hash-b64>
    if (stored == nullptr || strncmp(stored, "pbkdf2:sha256:", 14) != 0)
        return false;

    const char* p = stored + 14;
    uint32_t iters = 0;
    while (*p >= '0' && *p <= '9') { iters = iters * 10u + (uint32_t)(*p - '0'); p++; }
    if (*p != '$' || iters == 0 || iters > 2000000u)
        return false;
    p++;

    // Hard ceiling, and it protects the scan cycle rather than the password.
    //
    // PBKDF2 here costs ~124 us/iteration measured on a LOGO! 8.2 (20,000
    // iterations in 2.475 s), and open62541's AccessControl::activateSession
    // is synchronous with no deferral path in a single-threaded build -- so
    // the whole KDF runs inside one UA_Server_run_iterate, inside one scan.
    // At the editor's default of 600,000 that is 74 SECONDS of stalled PLC,
    // triggerable by any client that knows a username. At the 100,000 the LOGO
    // capability declares it is still 12.4 s.
    //
    // Refusing is the only safe answer: a PLC may not stop controlling its
    // process because someone tried to log in. See plan §4.4 -- the real fix
    // is encryption plus hardware SHA-256 (Phase 4), not a bigger budget.
    if (iters > OPCUA_KDF_MAX_ITERATIONS)
    {
        OPCUA_LOG("[auth] REFUSED: hash needs %lu iterations, target allows %lu "
                  "(~%lu ms of stalled scan) — see plan 4.4",
                  (unsigned long)iters, (unsigned long)OPCUA_KDF_MAX_ITERATIONS,
                  (unsigned long)((uint64_t)iters * 124u / 1000u));
        return false;
    }

    const char* salt_b64 = p;
    const char* dollar   = strchr(p, '$');
    if (dollar == nullptr)
        return false;
    const size_t salt_b64_len = (size_t)(dollar - salt_b64);
    const char* hash_b64 = dollar + 1;

    uint8_t salt[32];
    uint8_t want[32];
    const size_t salt_len = b64decode(salt_b64, salt_b64_len, salt, sizeof(salt));
    const size_t want_len = b64decode(hash_b64, strlen(hash_b64), want, sizeof(want));
    if (salt_len == 0 || want_len != 32)
        return false;

    // PBKDF2 with dkLen == hLen: exactly one block, INT(1) appended to the salt.
    HmacKey hk;
    hmac_key_init(&hk, (const uint8_t*)password, password_len);

    uint8_t msg[36];
    memcpy(msg, salt, salt_len);
    msg[salt_len]   = 0; msg[salt_len+1] = 0; msg[salt_len+2] = 0; msg[salt_len+3] = 1;

    uint8_t u[32], acc[32];
    hmac_with(&hk, msg, salt_len + 4, u);
    memcpy(acc, u, 32);
    for (uint32_t i = 1; i < iters; i++)
    {
        hmac_with(&hk, u, 32, u);
        for (uint8_t k = 0; k < 32; k++) acc[k] ^= u[k];
    }

    // Constant-time compare: never leak how much of the hash matched.
    uint8_t diff = 0;
    for (uint8_t k = 0; k < 32; k++) diff |= (uint8_t)(acc[k] ^ want[k]);
    ok = (diff == 0);

    g_last_us = (uint32_t)(micros() - t0);
    OPCUA_LOG("[auth] pbkdf2 iters=%lu took=%luus -> %s",
              (unsigned long)iters, (unsigned long)g_last_us, ok ? "OK" : "REJECT");
    return ok;
}

uint32_t opcua_auth_last_us(void) { return g_last_us; }

namespace {

/** open62541 hands us the username and the CLEARTEXT password (it has already
 *  undone whatever the token's security policy applied), which is exactly what
 *  the KDF needs and the only point in the system where the password exists in
 *  the clear. It is not copied or logged. */
UA_StatusCode login_cb(const UA_String* userName, const UA_ByteString* password,
                       size_t loginSize, const UA_UsernamePasswordLogin* logins,
                       void** sessionContext, void* loginContext)
{
    (void)loginSize; (void)logins; (void)loginContext;
    if (userName == nullptr || password == nullptr)
        return UA_STATUSCODE_BADUSERACCESSDENIED;

    // An ANONYMOUS token reaches this callback too, with an empty username --
    // the default access control consults the callback for every token type,
    // not just UserName. Rejecting it here refused anonymous logins on every
    // project that declares no users at all, which is most of them.
    //
    // Reaching this point with an empty username already means anonymous is
    // permitted: allowAnonymous is false whenever users are declared, and the
    // token handler refuses anonymous with BadIdentityTokenInvalid before the
    // callback is ever called.
    if (userName->length == 0)
        return UA_STATUSCODE_GOOD;

#if OPCUA_USER_COUNT > 0
    for (uint16_t i = 0; i < OPCUA_USER_COUNT; i++)
    {
        const char* u = OPCUA_USERS[i].username;
        const size_t ulen = strlen(u);
        if (ulen != userName->length || memcmp(u, userName->data, ulen) != 0)
            continue;
        if (!opcua_auth_verify((const char*)password->data, password->length,
                               OPCUA_USERS[i].password_hash))
            break;   // right user, wrong password: do not try the others
        // The role rides on the session so per-role permissions can use it
        // once they are enforced per session rather than any-role.
        if (sessionContext != nullptr)
            *sessionContext = (void*)(uintptr_t)OPCUA_USERS[i].role;
        return UA_STATUSCODE_GOOD;
    }
#else
    (void)sessionContext;
#endif
    return UA_STATUSCODE_BADUSERACCESSDENIED;
}

} // namespace

UA_StatusCode opcua_auth_install(UA_ServerConfig* config)
{
    if (config == nullptr)
        return UA_STATUSCODE_BADINVALIDARGUMENT;

    // With users declared, anonymous is off: declaring users and still
    // accepting anonymous would make them decorative.
    const UA_Boolean allow_anonymous = (OPCUA_USER_COUNT == 0);

    // One placeholder login entry, and it is not optional.
    //
    // UA_AccessControl_default only registers the UserName token policy on the
    // endpoint when usernamePasswordLoginSize > 0 -- a callback alone
    // registers nothing, so the endpoint advertised no UserName token and
    // every login failed with BadIdentityTokenInvalid before the callback was
    // ever reached. The entry's contents are never consulted: the token
    // handler calls the loginCallback INSTEAD of matching the static list.
    static UA_UsernamePasswordLogin placeholder;
    placeholder.username = UA_STRING_NULL;
    placeholder.password = UA_STRING_NULL;

    // Username tokens travel in the clear on a #None endpoint, and open62541
    // refuses that by default -- selectTokenPolicy() skips a UserName policy
    // when both the channel and the token policy are #None unless this flag is
    // set, which is why every login failed with BadIdentityTokenInvalid before
    // the access-control callback was ever reached.
    //
    // Opting in is the only way username auth can exist on this target at all:
    // the TM4C1294NCPDT has no TRNG and no crypto acceleration, so there is no
    // encrypting SecurityPolicy to carry the token (§6.1, plan). The password
    // is therefore exposed to anyone who can see the traffic. That is a real
    // limitation of a #None server and belongs in the user-facing docs, not
    // buried here -- but it is strictly better than the alternative on offer,
    // which is no authentication at all.
    config->allowNonePolicyPassword = true;

    // Username tokens travel in the clear on a #None endpoint. That is a
    // property of running without encryption, not of this code, and the
    // library warns about it too; it is why the VPP's security capability and
    // the user-facing docs have to say so plainly.
    const UA_StatusCode rc = UA_AccessControl_defaultWithLoginCallback(
        config, allow_anonymous, nullptr,
        (OPCUA_USER_COUNT > 0) ? 1 : 0, &placeholder, login_cb, nullptr);
    OPCUA_LOG("[auth] access control: %u user(s), anonymous %s, rc=0x%08lx",
              (unsigned)OPCUA_USER_COUNT, allow_anonymous ? "allowed" : "refused",
              (unsigned long)rc);
    return rc;
}

uint8_t opcua_auth_role_of(const char* username, size_t len)
{
#if OPCUA_USER_COUNT > 0
    for (uint16_t i = 0; i < OPCUA_USER_COUNT; i++)
    {
        const char* u = OPCUA_USERS[i].username;
        if (strlen(u) == len && memcmp(u, username, len) == 0)
            return OPCUA_USERS[i].role;
    }
#else
    (void)username; (void)len;
#endif
    return 0xFF;
}

#endif // OPCUA_ENABLED
