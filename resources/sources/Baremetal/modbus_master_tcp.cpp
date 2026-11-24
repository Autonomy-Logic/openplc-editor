// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_master_tcp.h"

#if MB_MASTER_ENABLED && MB_MASTER_TCP_ENABLED

#include <string.h>

#include "baremetal_net.h"
#include "modbus_master_util.h"

namespace {

/** First wait before a reconnect, in ms; each further attempt waits 1.5 times longer. */
const uint32_t RETRY_FIRST_MS = 2000;
/** Longest wait between two reconnect attempts, in ms. */
const uint32_t RETRY_MAX_MS = 30000;

/** Connection state of one endpoint. */
enum LinkState : uint8_t
{
    LINK_IDLE,
    LINK_WAIT,
    LINK_CONNECTING,
    LINK_UP,
    LINK_GIVEN_UP,
    /** The connection is still open from before a STOP edge and closes in a pass with no other close. */
    LINK_CLOSING
};

/** One endpoint: its connection, its Reconnect timing, the request in flight and its receive buffer. */
struct Endpoint
{
    bm_net::Connection conn;
    uint8_t state;
    bool in_flight;
    /** Set when a frame was rejected: no send for the rest of this pass. */
    bool quiet;
    uint16_t tid;
    /** MBAP length field the response to the request in flight must carry. */
    uint16_t expected;
    uint16_t rx_len;
    uint32_t retry_at;
    uint32_t retry_delay;
    uint32_t sent_at;
    mb_master_request_t req;
    uint8_t rx[MB_MASTER_ADU_MAX];
};

Endpoint g_endpoints[MB_MASTER_ENDPOINT_COUNT];

/** The request being sent: MBAP header, unit id and PDU, written in one call. */
uint8_t g_tx[MB_MASTER_ADU_MAX];

/** A connection was closed in the current master pass, so no connect starts before the next one. */
bool g_closed_this_pass = false;

/** The network link as the current master pass sees it: not asked yet, down or up. */
enum NetAnswer : uint8_t
{
    NET_UNASKED,
    NET_DOWN,
    NET_UP
};

/** The answer of bm_net::link_up() for the current master pass, asked at most once per pass. */
uint8_t g_net_this_pass = NET_UNASKED;

/** Whether the board's network link is up, asked of the seam on the first call of the pass and kept for the rest. */
bool network_up()
{
    if (g_net_this_pass == NET_UNASKED)
        g_net_this_pass = bm_net::link_up() ? NET_UP : NET_DOWN;
    return g_net_this_pass == NET_UP;
}

/** Whether an endpoint in `state` still holds an open connection. */
bool link_open(uint8_t state)
{
    return state == LINK_CONNECTING || state == LINK_UP || state == LINK_CLOSING;
}

/** Close the connection of endpoint `e` and mark the pass as one that closed a connection. */
void link_close(uint16_t e)
{
    g_endpoints[e].conn.close();
    g_closed_this_pass = true;
}

/** Close the connection of endpoint `e`, drop its request and received bytes, and apply error handling. */
void link_drop(uint16_t e)
{
    Endpoint &ep = g_endpoints[e];
    link_close(e);
    ep.in_flight = false;
    ep.quiet = false;
    ep.rx_len = 0;
    mb_master_link_down(MB_MASTER_TCP, e);
}

/** The connection of endpoint `e` failed or was lost: close it, apply error handling, then retry or give up. */
void link_lost(uint16_t e)
{
    Endpoint &ep = g_endpoints[e];
    link_drop(e);
    if (MB_MASTER_ENDPOINTS[e].reconnect != 0)
    {
        ep.state = LINK_WAIT;
        ep.retry_at = (uint32_t)millis() + ep.retry_delay;
        const uint32_t next = ep.retry_delay + ep.retry_delay / 2;
        ep.retry_delay = next < RETRY_MAX_MS ? next : RETRY_MAX_MS;
    }
    else
    {
        ep.state = LINK_GIVEN_UP;
    }
}

/** A connect of endpoint `e` failed: an attempt as link_lost() counts it while the network link is up; while it is
 *  down the connection is closed and the endpoint waits for the link, its Reconnect timing unchanged. */
void connect_failed(uint16_t e)
{
    if (network_up())
    {
        link_lost(e);
        return;
    }
    Endpoint &ep = g_endpoints[e];
    link_drop(e);
    ep.state = LINK_WAIT;
    ep.retry_at = (uint32_t)millis();
}

/** Follow a connect in progress to its end. */
void link_poll_connect(uint16_t e)
{
    Endpoint &ep = g_endpoints[e];
    const bm_net::ConnStatus status = ep.conn.poll();
    if (status == bm_net::BM_CONN_CONNECTED)
    {
        ep.state = LINK_UP;
        ep.retry_delay = RETRY_FIRST_MS;
        ep.in_flight = false;
        ep.quiet = false;
        ep.rx_len = 0;
    }
    else if (status != bm_net::BM_CONN_PENDING)
    {
        connect_failed(e);
    }
}

/** Start connecting endpoint `e`, with its timeout as the bound on the connect. */
void link_connect(uint16_t e)
{
    const mb_master_endpoint_t &endpoint = MB_MASTER_ENDPOINTS[e];
    Endpoint &ep = g_endpoints[e];
    ep.state = LINK_CONNECTING;
    if (!ep.conn.start(endpoint.ip, endpoint.port, endpoint.timeout_ms))
    {
        connect_failed(e);
        return;
    }
    link_poll_connect(e);
}

/** The request in flight failed: one failed poll, the connection stays up. */
void request_failed(Endpoint &ep)
{
    ep.in_flight = false;
    ep.rx_len = 0;
    mb_master_fail(&ep.req);
}

/** Drop the first `count` received bytes. */
void drop(Endpoint &ep, uint16_t count)
{
    memmove(ep.rx, &ep.rx[count], (size_t)(ep.rx_len - count));
    ep.rx_len = (uint16_t)(ep.rx_len - count);
}

/** Match received bytes to the request in flight: drop another transaction's frame or unframeable bytes, fail
 *  on a wrong protocol id, length or unit id, and hand a complete frame to the core. */
void take_response(Endpoint &ep)
{
    while (ep.in_flight && ep.rx_len >= MB_MASTER_MBAP_LEN)
    {
        const uint16_t tid = get16(&ep.rx[0]);
        const uint16_t protocol = get16(&ep.rx[2]);
        const uint16_t length = get16(&ep.rx[4]);
        const uint32_t frame = 6u + length;

        if (tid != ep.tid)
        {
            if (protocol != 0 || length < 2 || frame > sizeof(ep.rx))
            {
                ep.rx_len = 0;
                return;
            }
            if (ep.rx_len < frame)
                return;
            drop(ep, (uint16_t)frame);
            continue;
        }

        if (protocol != 0 || length != ep.expected || ep.rx[6] != ep.req.unit)
        {
            request_failed(ep);
            ep.quiet = true;
            return;
        }
        if (ep.rx_len < frame)
            return;

        ep.in_flight = false;
        if (!mb_master_accept(&ep.req, &ep.rx[MB_MASTER_MBAP_LEN], (uint16_t)(length - 1)))
            ep.quiet = true;
        ep.rx_len = 0;
        return;
    }
}

/** Send the next request due on endpoint `e`, only if the stack has room for all of it. */
void send_next(uint16_t e)
{
    Endpoint &ep = g_endpoints[e];
    const uint32_t now = (uint32_t)millis();
    const uint16_t pdu_len = mb_master_next_request(MB_MASTER_TCP, e, now, &ep.req, &g_tx[MB_MASTER_MBAP_LEN]);
    if (pdu_len == 0)
        return;

    ep.tid = (uint16_t)(ep.tid + 1);
    put16(&g_tx[0], ep.tid);
    put16(&g_tx[2], 0);
    put16(&g_tx[4], (uint16_t)(pdu_len + 1));
    g_tx[6] = ep.req.unit;
    ep.rx_len = 0;

    switch (ep.conn.send(g_tx, (size_t)(MB_MASTER_MBAP_LEN + pdu_len)))
    {
        case bm_net::BM_SEND_OK:
            ep.in_flight = true;
            ep.sent_at = now;
            ep.expected = (uint16_t)(mb_master_response_pdu_len(&ep.req) + 1);
            break;
        case bm_net::BM_SEND_NO_ROOM:
            mb_master_fail(&ep.req);
            break;
        default:
            link_lost(e);
            break;
    }
}

/** One pass over a connected endpoint: receive, match, time out, send. */
void link_exchange(uint16_t e)
{
    Endpoint &ep = g_endpoints[e];
    const int got = ep.conn.read(&ep.rx[ep.rx_len], sizeof(ep.rx) - ep.rx_len);
    if (got < 0)
    {
        link_lost(e);
        return;
    }
    ep.rx_len = (uint16_t)(ep.rx_len + got);

    if (!ep.in_flight)
    {
        ep.rx_len = 0;
    }
    else
    {
        take_response(ep);
        if (ep.in_flight && (uint32_t)((uint32_t)millis() - ep.sent_at) >= MB_MASTER_ENDPOINTS[e].timeout_ms)
            request_failed(ep);
        if (ep.rx_len >= sizeof(ep.rx))
            ep.rx_len = 0;
    }

    if (!ep.in_flight && !ep.quiet)
        send_next(e);
    ep.quiet = false;
}

}

void mb_master_tcp_start(void)
{
    const uint32_t now = (uint32_t)millis();
    for (uint16_t e = 0; e < MB_MASTER_ENDPOINT_COUNT; e++)
    {
        Endpoint &ep = g_endpoints[e];
        ep.in_flight = false;
        ep.quiet = false;
        ep.rx_len = 0;
        ep.retry_delay = RETRY_FIRST_MS;
        ep.retry_at = now;
        ep.state = link_open(ep.state) ? LINK_CLOSING : LINK_WAIT;
        mb_master_link_down(MB_MASTER_TCP, e);
    }
}

void mb_master_tcp_stop(void)
{
    bool closed = false;
    for (uint16_t e = 0; e < MB_MASTER_ENDPOINT_COUNT; e++)
    {
        Endpoint &ep = g_endpoints[e];
        ep.in_flight = false;
        ep.quiet = false;
        ep.rx_len = 0;
        if (BM_NET_CLOSE_WAITS && closed && link_open(ep.state))
        {
            ep.state = LINK_CLOSING;
            continue;
        }
        if (link_open(ep.state))
        {
            closed = true;
            ep.conn.close();
        }
        ep.state = LINK_IDLE;
    }
}

void mb_master_tcp_service(void)
{
    g_closed_this_pass = false;
    g_net_this_pass = NET_UNASKED;
    for (uint16_t e = 0; e < MB_MASTER_ENDPOINT_COUNT; e++)
    {
        Endpoint &ep = g_endpoints[e];
        switch (ep.state)
        {
            case LINK_CLOSING:
                if (!g_closed_this_pass)
                {
                    link_close(e);
                    ep.state = LINK_WAIT;
                }
                break;
            case LINK_CONNECTING:
                link_poll_connect(e);
                break;
            case LINK_UP:
                link_exchange(e);
                break;
            default:
                break;
        }
    }
    if (g_closed_this_pass)
        return;
    const uint32_t now = (uint32_t)millis();
    for (uint16_t e = 0; e < MB_MASTER_ENDPOINT_COUNT; e++)
    {
        if (g_endpoints[e].state == LINK_WAIT && reached(now, g_endpoints[e].retry_at))
        {
            if (network_up())
                link_connect(e);
            return;
        }
    }
}

#endif
