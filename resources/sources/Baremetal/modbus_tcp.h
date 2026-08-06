/*
modbus_tcp.h - Modbus TCP transport (Ethernet / WiFi / ESP ETH)
Copyright (C) 2022 OpenPLC - Thiago Alves

The TCP wire: brings the platform networking stack up, accepts up to
MAX_SRV_CLIENTS connections and services MBAP-framed requests. Like the serial
transport it fills mb_frame, calls process_mbpacket() and writes the response
back — no knowledge of the function-code set.
*/

#ifndef MODBUS_TCP_H
#define MODBUS_TCP_H

#include "modbus_frame.h"

//Platform specific defines and includes
#ifdef MBTCP_ETHERNET
#include <SPI.h>
#ifdef BOARD_ESP32
    // I²C-address of Ethernet PHY (0 or 1 for LAN8720, 31 for TLK110)
    #define ETH_PHY_ADDR 0                      // DEFAULT VALUE IS 0 YOU CAN OMIT IT
    // Type of the Ethernet PHY (LAN8720 or TLK110)
    #define ETH_PHY_TYPE ETH_PHY_LAN8720        // DEFAULT VALUE YOU CAN OMIT IT
    // Pin# of the enable signal for the external crystal oscillator (-1 to disable for internal APLL source)
    #define ETH_PHY_POWER -1                    // DEFAULT VALUE YOU CAN OMIT IT
    // Pin# of the I²C clock signal for the Ethernet PHY
    #define ETH_PHY_MDC 23                      // DEFAULT VALUE YOU CAN OMIT IT
    // Pin# of the I²C IO signal for the Ethernet PHY
    #define ETH_PHY_MDIO 18                     // DEFAULT VALUE YOU CAN OMIT IT
    // External clock from crystal oscillator
    #define ETH_CLK_MODE ETH_CLOCK_GPIO0_IN     // DEFAULT VALUE YOU CAN OMIT IT
    #include <ETH.h>
    #include <WiFi.h>
#else
    #include <Ethernet.h>
#endif
#endif

#ifdef MBTCP_WIFI
#if defined(BOARD_ESP8266)
#include <ESP8266WiFi.h>
#elif defined(BOARD_ESP32)
#include <WiFi.h>
#elif defined(BOARD_WIFININA)
#include <WiFiNINA.h>
#else
#include <SPI.h>
#include <WiFi.h>
#endif
#endif

#ifdef MBTCP_ETHERNET
#ifdef BOARD_ESP32
    extern WiFiServer mb_server;
#else
    extern EthernetServer mb_server;
#endif
    extern uint8_t mb_mbap[MBAP_SIZE];
#ifdef BOARD_PORTENTA
    extern EthernetClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

#ifdef MBTCP_WIFI
    extern WiFiServer mb_server;
    extern uint8_t mb_mbap[MBAP_SIZE];
#if defined(BOARD_ESP8266) || defined(BOARD_ESP32) || defined(BOARD_PORTENTA) || defined(BOARD_PICOW)
    extern WiFiClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

#ifdef MBTCP
void mbconfig_ethernet_iface(uint8_t *mac, uint8_t *ip, uint8_t *dns, uint8_t *gateway, uint8_t *subnet);
void handle_tcp();
#endif

#endif
