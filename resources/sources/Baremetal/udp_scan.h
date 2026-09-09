/*
 * udp_scan.h -- network-discovery ("Search") responder for baremetal runtimes.
 *
 * Answers the OpenPLC editor's discovery probe so the device appears in the
 * editor's device-search list. The editor broadcasts the ASCII magic
 * "OPENPLC_DISCOVER_V1" to UDP :33333 and reads replies as JSON, taking the
 * device IP from the UDP source address (see the editor's discover-runtimes).
 * We reply, unicast, to the sender with an advertisement.
 *
 * Feature-gated, not board-gated: compiled in only when the build defines
 * SUPPORTS_UDP_SCAN (declared per target, e.g. from a VPP's HAL compiler flags).
 * Uses only the generic Arduino UDP + Ethernet API, so any target whose network
 * library provides EthernetUDP / Ethernet.macAddress() can opt in.
 *
 * The reply carries:
 *   - "mac": the device MAC (unique per unit) so devices are distinguishable
 *     even when several share a default IP;
 *   - "device"/"hostname": a brand/type string a VPP supplies at link time via
 *     the weak symbol OPLC_DEVICE_NAME (see below); a build that supplies none
 *     stays generic.
 *
 * Brand string: a VPP declares its identity by defining OPLC_DEVICE_NAME in its
 * HAL (a strong symbol overriding the weak default provided by the runtime).
 * This avoids passing a spaced string through compiler flags, which arduino-cli
 * does not preserve. Fallback is a generic label when no VPP defines it.
 *
 * Header-only; lives with the runtime sources, not in any one board's core.
 */
#ifndef UDP_SCAN_H
#define UDP_SCAN_H

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
    if (len <= 0) return;

    _udp_scan.beginPacket(rip, rport);
    _udp_scan.write((const uint8_t *)reply, (size_t)len);
    _udp_scan.endPacket();
}

#endif /* UDP_SCAN_H */
