/*
 * udp_scan.h -- network-discovery ("Search") responder for baremetal runtimes.
 *
 * The editor broadcasts "OPENPLC_DISCOVER_V1" to UDP :33333 and reads replies as
 * JSON, taking the device IP from the UDP source address. We reply unicast with
 * "mac" (so units sharing a default IP stay distinguishable) and "device".
 *
 * Feature-gated, not board-gated: compiled in only when the build defines
 * SUPPORTS_UDP_SCAN. Uses only the generic Arduino UDP + Ethernet API.
 *
 * A VPP declares its identity by defining OPLC_DEVICE_NAME in its HAL, a strong
 * symbol overriding the weak default. Header-only.
 */
#ifndef UDP_SCAN_H
#define UDP_SCAN_H

/* Longest device name the discovery reply can carry.
 *
 * reply[] is 192 bytes; the fixed JSON is 126 with the MAC rendered, and the
 * name appears TWICE (hostname and device), so the two copies share the
 * remaining 66 -- 33 each, one byte of which is the terminator. */
#define UDP_SCAN_NAME_MAX 32

#include <Ethernet.h>
#include <EthernetUdp.h>
#include <IPAddress.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define UDP_SCAN_PORT   33333
#define UDP_SCAN_MAGIC  "OPENPLC_DISCOVER_V1"   /* 19 bytes, no NUL on the wire */

/* Optional per-VPP brand/type string. The runtime provides a weak NULL default
 * (see runtime_glue below); a VPP HAL defines a strong symbol to override it. */
#ifdef __cplusplus
extern "C" {
#endif
extern const char *OPLC_DEVICE_NAME;
#ifdef __cplusplus
}
#endif

static EthernetUDP _udp_scan;
static bool        _udp_scan_ready = false;

static inline void udp_scan_begin(void)
{
    if (_udp_scan_ready) return;
    if (_udp_scan.begin(UDP_SCAN_PORT)) _udp_scan_ready = true;
}

static inline void udp_scan_poll(void)
{
    if (!_udp_scan_ready) return;
    int sz = _udp_scan.parsePacket();
    if (sz <= 0) return;

    uint8_t buf[40];
    int n = _udp_scan.read(buf, sizeof(buf));
    if (n < (int)(sizeof(UDP_SCAN_MAGIC) - 1)) return;
    if (memcmp(buf, UDP_SCAN_MAGIC, sizeof(UDP_SCAN_MAGIC) - 1) != 0) return;

    IPAddress rip   = _udp_scan.remoteIP();
    uint16_t  rport = _udp_scan.remotePort();

    uint8_t mac[6] = {0, 0, 0, 0, 0, 0};
    Ethernet.macAddress(mac);

    const char *dev = OPLC_DEVICE_NAME;
    if (dev == 0 || dev[0] == 0) dev = "OpenPLC device";

    /* Bound the NAME, not the frame. snprintf() returns the length it WOULD
     * have written, so using it as the write length reads past reply[] as soon
     * as the JSON does not fit -- and the name is interpolated twice, so the
     * budget is halved. Truncating the frame instead would keep the read in
     * bounds but put malformed JSON on the wire, which the editor's scanner
     * drops: the device would simply stop appearing, for a reason nothing
     * reports. Cropping the name keeps the reply well-formed at any length. */
    char devbuf[UDP_SCAN_NAME_MAX + 1];
    {
        size_t i = 0;
        while (i < UDP_SCAN_NAME_MAX && dev[i] != 0) { devbuf[i] = dev[i]; i++; }
        devbuf[i] = 0;
        dev = devbuf;
    }

    /* Reply as an OpenPLC advertisement so the editor's existing scan lists us;
     * the editor takes the device IP from our UDP source address. */
    char reply[192];
    int len = snprintf(reply, sizeof(reply),
        "{\"service\":\"openplc-runtime\","
        "\"hostname\":\"%s\","
        "\"device\":\"%s\","
        "\"mac\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
        "\"runtime_version\":\"baremetal\","
        "\"api_port\":502}",
        dev, dev,
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    /* Belt and braces: the name is bounded above, so this cannot fire today.
     * It is here so a later field added to the JSON cannot reintroduce the
     * overread silently. */
    if (len <= 0 || (size_t)len >= sizeof(reply)) return;

    _udp_scan.beginPacket(rip, rport);
    _udp_scan.write((const uint8_t *)reply, (size_t)len);
    _udp_scan.endPacket();
}

#endif /* UDP_SCAN_H */
