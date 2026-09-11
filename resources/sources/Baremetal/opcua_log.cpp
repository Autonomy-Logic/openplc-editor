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

namespace {

// Port 23. Telnet clients send option negotiation on connect, which we simply
// ignore: this is a one-way log, so anything the client says is noise.
opcua_server_impl_t g_log_server(23);
opcua_client_impl_t g_log_client;
bool g_log_started = false;

// Ring buffer, so lines produced before anyone attaches are not lost — the
// interesting ones happen during init, which is over long before a developer
// can connect.
constexpr size_t kRing = 2048;
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
