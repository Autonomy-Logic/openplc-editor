/*
opcua_log.cpp - telnet debug log sink
Copyright (C) 2026 Autonomy Logic
*/

#include "opcua_log.h"

#if OPCUA_ENABLED && OPCUA_DEBUG_LOG

#include <Arduino.h>
#include <stdarg.h>
#include <stdio.h>

#include "opcua_net.h"   // for the same concrete server/client types

// lwIP's counters. Only meaningful on the lwIP-backed targets (the LOGO!);
// guarded so the file still builds on a shield/WiFi core that has no lwIP.
#if defined(BOARD_LOGO8)
#include "lwip/stats.h"
#include "lwip/memp.h"
#define OPCUA_HAVE_LWIP_STATS 1
#else
#define OPCUA_HAVE_LWIP_STATS 0
#endif

namespace {

// Port 23. Telnet clients send option negotiation on connect, which we simply
// ignore: this is a one-way log, so anything the client says is noise.
opcua_server_impl_t g_log_server(23);
opcua_client_impl_t g_log_client;
bool g_log_started = false;

// Ring buffer, so lines produced before anyone attaches are not lost — the
// interesting ones happen during init, which is over long before a developer
// can connect.
// Large enough that a periodic census cannot push the interesting one-shot
// events (accept / drop / init failures) out before a developer attaches.
constexpr size_t kRing = 6144;
char     g_ring[kRing];
size_t   g_head = 0;   // write cursor
size_t   g_len  = 0;   // valid bytes
bool     g_flushed = false;

void ring_put(const char* s, size_t n)
{
    for (size_t i = 0; i < n; i++)
    {
        g_ring[g_head] = s[i];
        g_head = (g_head + 1) % kRing;
        if (g_len < kRing)
            g_len++;
    }
}

} // namespace

void opcua_log_begin(void)
{
    if (g_log_started)
        return;
    g_log_server.begin();
    g_log_started = true;
}

void opcua_log_poll(void)
{
    if (!g_log_started)
        return;
    if (!g_log_client || !g_log_client.connected())
    {
        opcua_client_impl_t incoming = g_log_server.available();
        if (incoming)
        {
            g_log_client = incoming;
            g_flushed = false;
        }
    }
    if (g_log_client && g_log_client.connected() && !g_flushed)
    {
        // Replay the backlog once, oldest first.
        const size_t start = (g_head + kRing - g_len) % kRing;
        for (size_t i = 0; i < g_len; i++)
            g_log_client.write((uint8_t)g_ring[(start + i) % kRing]);
        g_flushed = true;
    }
    // Drain and discard anything the client sends (telnet negotiation).
    while (g_log_client && g_log_client.available() > 0)
        (void)g_log_client.read();
}

void opcua_log_netstats(const char* tag)
{
#if OPCUA_HAVE_LWIP_STATS && MEMP_STATS && MEM_STATS
    // `err` is the one that matters: it counts allocations lwIP REFUSED.
    // A non-zero err on TCP_PCB is exhaustion, and exhaustion is what stops
    // a listener from accepting while an already-open socket (Modbus) keeps
    // working — exactly the asymmetry observed.
    opcua_logf("[net:%s] heap used=%u max=%u avail=%u err=%u", tag,
               (unsigned)lwip_stats.mem.used, (unsigned)lwip_stats.mem.max,
               (unsigned)lwip_stats.mem.avail, (unsigned)lwip_stats.mem.err);
    opcua_logf("[net:%s] tcp_pcb used=%u max=%u err=%u | listen used=%u err=%u", tag,
               (unsigned)lwip_stats.memp[MEMP_TCP_PCB].used,
               (unsigned)lwip_stats.memp[MEMP_TCP_PCB].max,
               (unsigned)lwip_stats.memp[MEMP_TCP_PCB].err,
               (unsigned)lwip_stats.memp[MEMP_TCP_PCB_LISTEN].used,
               (unsigned)lwip_stats.memp[MEMP_TCP_PCB_LISTEN].err);
    opcua_logf("[net:%s] seg used=%u err=%u | pbuf used=%u err=%u | pool used=%u err=%u", tag,
               (unsigned)lwip_stats.memp[MEMP_TCP_SEG].used,
               (unsigned)lwip_stats.memp[MEMP_TCP_SEG].err,
               (unsigned)lwip_stats.memp[MEMP_PBUF].used,
               (unsigned)lwip_stats.memp[MEMP_PBUF].err,
               (unsigned)lwip_stats.memp[MEMP_PBUF_POOL].used,
               (unsigned)lwip_stats.memp[MEMP_PBUF_POOL].err);
#else
    (void)tag;
#endif
}

void opcua_logf(const char* fmt, ...)
{
    char line[160];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(line, sizeof(line) - 2, fmt, ap);
    va_end(ap);
    if (n < 0)
        return;
    if ((size_t)n > sizeof(line) - 3)
        n = (int)sizeof(line) - 3;
    line[n++] = '\r';
    line[n++] = '\n';

    ring_put(line, (size_t)n);

    // Non-blocking: if the peer is not draining, the line stays in the ring
    // and the scan cycle is untouched.
    if (g_log_client && g_log_client.connected() && g_flushed)
        g_log_client.write((const uint8_t*)line, (size_t)n);
}

#endif // OPCUA_ENABLED && OPCUA_DEBUG_LOG
