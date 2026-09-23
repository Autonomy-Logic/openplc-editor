/*
modbus_tcp.cpp - Modbus TCP transport (Ethernet / WiFi / ESP ETH)
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include <string.h>       // memset -- wiping a discarded frame

#include "modbus_tcp.h"
#include "modbus_pdu.h"   // process_mbpacket

// The listen port travels with the project's Modbus server. A firmware built
// before it did -- or by a toolchain that does not emit it -- keeps the IANA
// default it always listened on.
#ifndef MBTCP_PORT
    #define MBTCP_PORT 502
#endif

#if defined(MBTCP_ETHERNET) && defined(MB_TCP_ACTIVE)
#ifdef BOARD_ESP32
    WiFiServer mb_server(MBTCP_PORT);
	WiFiClient mb_serverClients[MAX_SRV_CLIENTS];
#else
    EthernetServer mb_server(MBTCP_PORT);
#endif
    uint8_t mb_mbap[MBAP_SIZE];
// The Ethernet route's client table. The multi-client block in handle_tcp()
// is entered for PORTENTA and PICOW alike, so both need the array; declaring it
// for only one of them is why a Pico W with an Ethernet module failed to
// compile at modbus_tcp.cpp:137 with 'mb_serverClients' was not declared.
#if defined(BOARD_PORTENTA) || defined(BOARD_PICOW)
    EthernetClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

#if defined(MBTCP_WIFI) && defined(MB_TCP_ACTIVE)
    WiFiServer mb_server(MBTCP_PORT);
    uint8_t mb_mbap[MBAP_SIZE];
#if defined(BOARD_ESP8266) || defined(BOARD_ESP32) || defined(BOARD_PORTENTA) || defined(BOARD_PICOW)
    WiFiClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

// Bringing the link up is the NETWORK's job, not the Modbus server's. It used
// to live under MBTCP, so a project that enabled the network without serving
// Modbus TCP compiled a firmware that never configured the interface -- fine on
// a USB board, fatal on one reached only over Ethernet.
#if defined(OPLC_NET_ENABLED)
void mbconfig_ethernet_iface(uint8_t *mac, uint8_t *ip, uint8_t *dns, uint8_t *gateway, uint8_t *subnet)
{
    #ifdef MBTCP_ETHERNET
        #ifdef BOARD_ESP32

            ETH.begin();

            if (ip != NULL && subnet != NULL && gateway != NULL)
                (ETH.config(ip, gateway, subnet, dns));

        #else
            // The module's chip select, when the board says where it is. Both
            // libraries default to pin 10 (the Uno shield's wiring), which is
            // wrong on every board that is not an Uno -- the Pico's SPI0 CS is
            // 17. Must precede begin(), which is what talks to the chip.
            #ifdef MBTCP_ETH_CS
                Ethernet.init(MBTCP_ETH_CS);
            #endif
            if (ip == NULL)
                Ethernet.begin(mac);
            else if (dns == NULL)
                Ethernet.begin(mac, IPAddress(ip));
            else if (gateway == NULL)
                Ethernet.begin(mac, IPAddress(ip), IPAddress(dns));
            else if (subnet == NULL)
                Ethernet.begin(mac, IPAddress(ip), IPAddress(dns), IPAddress(gateway));
            else
                Ethernet.begin(mac, IPAddress(ip), IPAddress(dns), IPAddress(gateway), IPAddress(subnet));
        #endif

//        int num_tries = 0;
//        while (!ETH.linkUp())
//        {
//            delay(500);
//            num_tries++;
//            if (num_tries == 20) break;
//        }

    #endif
    #ifdef MBTCP_WIFI
        #if defined(BOARD_ESP8266) || defined(BOARD_ESP32)
            if (ip != NULL && gateway != NULL && subnet != NULL && dns != NULL)
            {
                uint8_t secondaryDNS[] = {8, 8, 8, 8};
                WiFi.config(IPAddress(ip), IPAddress(gateway), IPAddress(subnet), IPAddress(dns), IPAddress(secondaryDNS));
            }
        #elif defined(BOARD_PORTENTA)
            if (ip != NULL && subnet != NULL && gateway != NULL)
            {
                WiFi.config(IPAddress(ip), IPAddress(subnet), IPAddress(gateway));
            }
        #else
            if (ip != NULL)
            {
                if (dns == NULL)
                    WiFi.config(IPAddress(ip));
                else if (gateway == NULL)
                    WiFi.config(IPAddress(ip), IPAddress(dns));
                else if (subnet == NULL)
                    WiFi.config(IPAddress(ip), IPAddress(dns), IPAddress(gateway));
                else
                    WiFi.config(IPAddress(ip), IPAddress(dns), IPAddress(gateway), IPAddress(subnet));
            }
        #endif
        WiFi.begin(MBTCP_SSID, MBTCP_PWD);
        int num_tries = 0;
        while (WiFi.status() != WL_CONNECTED)
        {
            delay(500);
            num_tries++;
            if (num_tries == 10) break;
        }
    #endif

}

#endif  // OPLC_NET_ENABLED

#ifdef MB_TCP_ACTIVE
/** Start listening for Modbus TCP. Separate from the link bring-up above
 *  because a board can have a network without serving Modbus over it -- the
 *  debugger, the ethernet upload, OPC-UA and S7Comm all use the same link. */
void mbtcp_server_begin(void)
{
    #if defined(MBTCP_WIFI) && (defined(BOARD_ESP8266) || defined(BOARD_ESP32))
        mb_server.setNoDelay(true);
    #endif
    mb_server.begin();
}

void handle_tcp()
{
    #ifdef MBTCP_ETHERNET
        #ifdef BOARD_ESP32
            WiFiClient client = mb_server.available();
        #else
            EthernetClient client = mb_server.available();
        #endif
    #endif

    #if defined(MBTCP_WIFI) && !defined(BOARD_ESP8266) && !defined(BOARD_ESP32)
        WiFiClient client = mb_server.available();
    #endif

    //ESP and Portenta boards have a slightly different implementation of the WiFi/Ethernet API - therefore their specific
    //code lies below
    #if (defined(BOARD_ESP8266) || defined(BOARD_ESP32) || defined(BOARD_PORTENTA)) || defined(BOARD_PICOW) && (defined(MBTCP_WIFI) || defined(MBTCP_ETHERNET))


        #if defined(BOARD_PORTENTA) || defined(BOARD_PICOW) || (defined(BOARD_ESP32) && defined(MBTCP_ETHERNET))
        if (client)
        #else
        if (mb_server.hasClient())
        #endif
        {
            for (int i = 0; i < MAX_SRV_CLIENTS; i++)
            {
                if (!mb_serverClients[i]) //equivalent to !serverClients[i].connected()
                {
                    #if defined(BOARD_PORTENTA) || defined(BOARD_PICOW) || defined(BOARD_ESP32) && defined(MBTCP_ETHERNET)
                    mb_serverClients[i] = client;
                    #else
                    mb_serverClients[i] = mb_server.available();
                    #endif
                    break;
                }
            }
        }

        //search all clients for data
        for (int i = 0; i < MAX_SRV_CLIENTS; i++)
        {
            int j = 0;


            if (mb_serverClients[i].connected() && mb_serverClients[i].available())

            {
                //Read packet


                while (mb_serverClients[i].available())
                {
                    mb_mbap[j] = mb_serverClients[i].read();
                    j++;
                    if (j==MBAP_SIZE) break;  //MBAP has 6 bytes (we use UnitID as SlaveID)
                }

                mb_frame_len = mb_mbap[4] << 8 | mb_mbap[5];

                if (mb_mbap[2] !=0 || mb_mbap[3] !=0) return;   //Not a MODBUSIP packet
                // Smallest legal frame is [unit][fc] = 2. The old floor of 6 was
                // the minimum for a standard DATA request ([unit][fc][addr:2]
                // [qty:2]), so it silently dropped any request SHORTER than that
                // before process_mbpacket() ever saw it:
                //
                //   0x41 debug-info   len 2  dropped
                //   0x46 status       len 2  dropped  (run/stop state + switch)
                //   0x47 version      len 2  dropped
                //   0x48 board id     len 2  dropped  (Connect's verification)
                //   0x4b run/stop     len 3  dropped  (the Stop/Run button)
                //   0x44 get-list     len 4+3n  passed
                //   0x45 md5          len 6     passed
                //
                // Which is why this went unnoticed for so long: a debug SESSION
                // only uses 0x44 and 0x45, so debugging over Modbus TCP worked
                // fine, while Connect and run/stop over TCP could never work. The
                // floor predates the split of the ModbusSlave monolith (it was in
                // there twice, verbatim) and was harmless until function codes
                // with no payload were introduced.
                //
                // Per-FC shape is validated in process_mbpacket(); over TCP the
                // MBAP length is authoritative, there being no CRC to check.
                if (mb_frame_len < 2 || mb_frame_len > MAX_MB_FRAME) return;      //Packet is too small or too big

                j = 0;
                while (mb_serverClients[i].available())
                {
                    mb_frame[j] = mb_serverClients[i].read();
                    j++;
                    if (j==mb_frame_len) break;
                }

                //Safety check - discard packages that lie about their size
                if (j != mb_frame_len) return;

                //Process packet and write back
                process_mbpacket();
                //Calculate packet length for MBAP header (mb_frame_len + 1)
                mb_mbap[4] = (mb_frame_len) >> 8;
                mb_mbap[5] = (mb_frame_len) & 0x00FF;

                uint8_t sendbuffer[mb_frame_len + MBAP_SIZE];

                //MBAP
                for (j = 0 ; j < MBAP_SIZE ; j++)
                    sendbuffer[j] = mb_mbap[j];

                //PDU Frame
                for (j = 0 ; j < mb_frame_len ; j++)
                    sendbuffer[j+MBAP_SIZE] = mb_frame[j];

                //Write back
                mb_serverClients[i].write(sendbuffer, mb_frame_len + MBAP_SIZE);
            }
        }

    //If this is not an ESP board or Portenta board, then here is the default code
    #else
        if (client)
        {
            if (client.connected())
            {
                int i = 0;
                while (client.available())
                {
                    mb_mbap[i] = client.read();
                    i++;
                    if (i==MBAP_SIZE) break;  //MBAP has 6 bytes (we use UnitID as SlaveID)
                }

                mb_frame_len = mb_mbap[4] << 8 | mb_mbap[5];

                if (mb_mbap[2] !=0 || mb_mbap[3] !=0) return;   //Not a MODBUSIP packet
                // Smallest legal frame is [unit][fc] = 2. The old floor of 6 was
                // the minimum for a standard DATA request ([unit][fc][addr:2]
                // [qty:2]), so it silently dropped any request SHORTER than that
                // before process_mbpacket() ever saw it:
                //
                //   0x41 debug-info   len 2  dropped
                //   0x46 status       len 2  dropped  (run/stop state + switch)
                //   0x47 version      len 2  dropped
                //   0x48 board id     len 2  dropped  (Connect's verification)
                //   0x4b run/stop     len 3  dropped  (the Stop/Run button)
                //   0x44 get-list     len 4+3n  passed
                //   0x45 md5          len 6     passed
                //
                // Which is why this went unnoticed for so long: a debug SESSION
                // only uses 0x44 and 0x45, so debugging over Modbus TCP worked
                // fine, while Connect and run/stop over TCP could never work. The
                // floor predates the split of the ModbusSlave monolith (it was in
                // there twice, verbatim) and was harmless until function codes
                // with no payload were introduced.
                //
                // Per-FC shape is validated in process_mbpacket(); over TCP the
                // MBAP length is authoritative, there being no CRC to check.
                if (mb_frame_len < 2 || mb_frame_len > MAX_MB_FRAME) return;      //Packet is too small or too big

                i = 0;
                while (client.available())
                {
                    mb_frame[i] = client.read();
                    i++;
                    if (i==mb_frame_len || i==MAX_MB_FRAME) break;
                }

                //Safety check - discard packages that lie about their size
                if (i != mb_frame_len)
                {
                    // Wipe what the liar wrote. The bytes are already in
                    // mb_frame, and process_mbpacket() dispatches on the buffer
                    // rather than on the read length, so leaving them let a
                    // SHORT follow-up frame execute on this frame's operands —
                    // which is how a rejected frame carrying the 0x4C magic
                    // could arm a later bare reboot request. There is a
                    // per-FC length guard in process_mbpacket() now too; this
                    // is the other half, so no stale operand survives the
                    // request that carried it.
                    memset(mb_frame, 0, i);
                    mb_frame_len = 0;
                    return;
                }

                //Process packet and write back
                process_mbpacket();
                //Calculate packet length for MBAP header (mb_frame_len + 1)
                mb_mbap[4] = (mb_frame_len) >> 8;
                mb_mbap[5] = (mb_frame_len) & 0x00FF;

                uint8_t sendbuffer[mb_frame_len + MBAP_SIZE];

                //MBAP
                for (i = 0 ; i < MBAP_SIZE ; i++)
                    sendbuffer[i] = mb_mbap[i];

                //PDU Frame
                for (i = 0 ; i < mb_frame_len ; i++)
                    sendbuffer[i+MBAP_SIZE] = mb_frame[i];

                //Write back
                client.write(sendbuffer, mb_frame_len + MBAP_SIZE);
            }
        }
    #endif
}
#endif
