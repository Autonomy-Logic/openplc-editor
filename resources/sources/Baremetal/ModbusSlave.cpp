/*
ModbusSlave.cpp - Source for Modbus Slave Library
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "ModbusSlave.h"
// Debug surface comes via the extern "C" shims in arduino_runtime_glue.h
// (openplc_debug_*) so this TU stays free of strucpp template-heavy headers
// and compiles cleanly in arduino-cli's path with the core's default C++
// standard (gnu++14 on mbed and others). The shims forward to
// strucpp::debug::handle_* inside arduino_runtime_glue.cpp, which is part
// of the precompiled OpenPLCUserLib archive built with -std=gnu++17.
#include "arduino_runtime_glue.h"

//Global Modbus vars
struct MBinfo modbus;
uint8_t mb_frame[MAX_MB_FRAME];
uint16_t mb_frame_len;
Stream* mb_serialport;
int8_t mb_txpin;
uint16_t mb_t15; // inter character time out
uint16_t mb_t35; // frame delay

#ifdef MBTCP_ETHERNET
#ifdef BOARD_ESP32
    WiFiServer mb_server(502);
	WiFiClient mb_serverClients[MAX_SRV_CLIENTS];
#else
    EthernetServer mb_server(502);
#endif
    uint8_t mb_mbap[MBAP_SIZE];
#ifdef BOARD_PORTENTA
    EthernetClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

#ifdef MBTCP_WIFI
    WiFiServer mb_server(502);
    uint8_t mb_mbap[MBAP_SIZE];
#if defined(BOARD_ESP8266) || defined(BOARD_ESP32) || defined(BOARD_PORTENTA) || defined(BOARD_PICOW)
    WiFiClient mb_serverClients[MAX_SRV_CLIENTS];
#endif
#endif

bool init_mbregs(uint8_t size_holding, uint8_t size_dint_memory, uint8_t size_lint_memory, uint8_t size_coils, uint8_t size_inputregs, uint8_t size_inputstatus)
{
    //Save sizes
    modbus.holding_size = size_holding;
    modbus.dint_memory_size = size_dint_memory;
    modbus.lint_memory_size = size_lint_memory;
    modbus.coils_size = size_coils;
    modbus.input_regs_size = size_inputregs;
    modbus.input_status_size = size_inputstatus;

    //round discrete regs sizes
    if (size_coils % 8 > 0)
        size_coils = (size_coils / 8) + 1;
    else
        size_coils = size_coils / 8;
    if (size_inputstatus % 8 > 0)
        size_inputstatus = (size_inputstatus / 8) + 1;
    else
        size_inputstatus = (size_inputstatus / 8);

    modbus.coils = (uint8_t *)malloc(size_coils * sizeof(uint8_t));
    if (modbus.coils == NULL) return false;
    memset(modbus.coils, 0, size_coils * sizeof(uint8_t));

    modbus.holding = (uint16_t *)malloc(size_holding * sizeof(uint16_t));
    if (modbus.holding == NULL) return false;
    memset(modbus.holding, 0, size_holding * sizeof(uint16_t));

    if (size_dint_memory > 0)
    {
        modbus.dint_memory = (uint32_t *)malloc(size_dint_memory * sizeof(uint32_t));
        if (modbus.dint_memory == NULL) return false;
        memset(modbus.dint_memory, 0, size_dint_memory * sizeof(uint32_t));
    }

    if (size_lint_memory > 0)
    {
        modbus.lint_memory = (uint64_t *)malloc(size_lint_memory * sizeof(uint64_t));
        if (modbus.lint_memory == NULL) return false;
        memset(modbus.lint_memory, 0, size_lint_memory * sizeof(uint64_t));
    }

    modbus.input_status = (uint8_t *)malloc(size_inputstatus * sizeof(uint8_t));
    if (modbus.input_status == NULL) return false;
    memset(modbus.input_status, 0, size_inputstatus * sizeof(uint8_t));

    modbus.input_regs = (uint16_t *)malloc(size_inputregs * sizeof(uint16_t));
    if (modbus.input_regs == NULL) return false;
    memset(modbus.input_regs, 0, size_inputregs * sizeof(uint16_t));

    return true;
}

bool get_discrete(uint16_t addr, bool regtype)
{
    uint8_t byte_addr = addr / 8;
    uint8_t bit_addr = addr % 8;
    if (regtype == COILS)
        return bitRead(modbus.coils[byte_addr], bit_addr);
    else
        return bitRead(modbus.input_status[byte_addr], bit_addr);
}

void write_discrete(uint16_t addr, bool regtype, bool value)
{
    uint8_t byte_addr = addr / 8;
    uint8_t bit_addr = addr % 8;
    if (regtype == COILS)
        bitWrite(modbus.coils[byte_addr], bit_addr, value);
    else
        bitWrite(modbus.input_status[byte_addr], bit_addr, value);
}

void mbconfig_serial_iface(Stream* port, long baud, int txPin)
{
    mb_serialport = port;
    mb_txpin = txPin;
    //(*port).begin(baud); //Initialization already happened on main .ino file

    //RS-485 control
    if (txPin >= 0)
    {
        pinMode(txPin, OUTPUT);
        digitalWrite(txPin, LOW);
    }

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (mb_serialport == &Serial3)
            Controllino_RS485Init();
    #elif defined(CONTROLLINO_MICRO)
    if (mb_serialport == &Serial2) {
        pinMode(CUSTOM_RS485_DEFAULT_DE_PIN, OUTPUT);
        pinMode(CUSTOM_RS485_DEFAULT_RE_PIN, OUTPUT);
        digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, LOW);
        digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, HIGH);
    }
    #endif

    // Modbus states that a baud rate higher than 19200 must use a fixed 750 us
    // for inter character time out. For baud rates below 19200 the timing
    // is more critical and has to be calculated.
    // E.g. 9600 baud in a 11 bit packet is 9600/11 = 872 characters per second
    // In milliseconds this will be 872 characters per 1000ms. So for 1 character
    // 1000ms/872 characters is 1.14583ms per character. Finally modbus states
    // an inter-character must be 1.5T or 1.5 times longer than a character. Thus
    // 1.5T = 1.14583ms * 1.5 = 1.71875ms.
    // Thus the formula is T1.5(us) = (1000ms * 1000(us) * 1.5 * 11bits)/baud
    // 1000ms * 1000(us) * 1.5 * 11bits = 16500000 can be calculated as a constant

    if (baud > 19200)
        mb_t15 = 750;
    else
        mb_t15 = 16500000/baud; // 1T * 1.5 = T1.5

    /* The modbus definition of a frame delay is a waiting period of 3.5 character times
    between packets.*/

    mb_t35 = mb_t15 * 3.5;
}


#ifdef MBTCP
void mbconfig_ethernet_iface(uint8_t *mac, uint8_t *ip, uint8_t *dns, uint8_t *gateway, uint8_t *subnet)
{
    #ifdef MBTCP_ETHERNET
        #ifdef BOARD_ESP32

            ETH.begin();

            if (ip != NULL && subnet != NULL && gateway != NULL)
                (ETH.config(ip, gateway, subnet, dns));

        #else
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
            mb_server.setNoDelay(true);
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

    mb_server.begin();

}
#endif

void mbtask()
{
    #ifdef MBTCP
        handle_tcp();
    #endif
    #ifdef MBSERIAL
        handle_serial();
    #endif
}

#ifdef MBTCP
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
                if (mb_frame_len < 6 || mb_frame_len > MAX_MB_FRAME) return;      //Packet is too small or too big

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
                if (mb_frame_len < 6 || mb_frame_len > MAX_MB_FRAME) return;      //Packet is too small or too big

                i = 0;
                while (client.available())
                {
                    mb_frame[i] = client.read();
                    i++;
                    if (i==mb_frame_len || i==MAX_MB_FRAME) break;
                }

                //Safety check - discard packages that lie about their size
                if (i != mb_frame_len) return;

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

#ifdef MBSERIAL
void handle_serial()
{
    mb_frame_len = 0;

    if ((*mb_serialport).available() == 0)
        return;

    while ((*mb_serialport).available() > mb_frame_len)
    {
        mb_frame_len = (*mb_serialport).available();
        delayMicroseconds(mb_t15);
    }

    //Check if packet is too big or too small
    if ((*mb_serialport).available() > MAX_MB_FRAME || (*mb_serialport).available() < 6)
    {
        //(*mb_serialport).println("Packet too big");
        //(*mb_serialport).flush();
        return;
    }

    //Read packet
    for (uint16_t i = 0; i < mb_frame_len; i++)
    {
        mb_frame[i] = (*mb_serialport).read();
    }

    //Validate crc
    uint16_t packet_crc;
    //Ignore CRC errors when using debugger functions
    if (mb_frame[1] != MB_FC_DEBUG_INFO && mb_frame[1] != MB_FC_DEBUG_SET && mb_frame[1] != MB_FC_DEBUG_GET && mb_frame[1] != MB_FC_DEBUG_GET_LIST && mb_frame[1] != MB_FC_DEBUG_GET_MD5)
    {
        packet_crc = ((mb_frame[mb_frame_len - 2] << 8) | mb_frame[mb_frame_len - 1]);
        if (packet_crc != calcCrc())
        {
        /* DEBUG
	    char buffer[100];
            (*mb_serialport).println("Invalid CRC for packet: ");
            int offset = 0; // Initialize offset for buffer
            for (int i = 0; i < mb_frame_len; i++)
            {
                offset += sprintf(buffer + offset, "%02X ", mb_frame[i]);
            }
            (*mb_serialport).println(buffer);
            (*mb_serialport).print("Packet_crc: ");
            (*mb_serialport).println(packet_crc);
            (*mb_serialport).print("Calc CRC: ");
            (*mb_serialport).println(calcCrc());
            (*mb_serialport).flush();
        */
	    return;
        }
    }

    //Validate SlaveID
    if (mb_frame[0] != modbus.slaveid)
    {
        (*mb_serialport).flush();
        return;
    }

    //Remove CRC (must do that before processing packet)
    mb_frame_len -= 2;

    //Process packet and write back
    process_mbpacket();

    //Add CRC
    //Check if response message is too big for this device
    if (mb_frame_len + 2 > MAX_MB_FRAME) exceptionResponse(mb_frame[1], MB_EX_SLAVE_FAILURE);
    mb_frame_len += 2; //increase frame length by two bytes to acomodate CRC
    packet_crc = calcCrc(); //calculate CRC of the new packet
    mb_frame[mb_frame_len - 2] = (uint8_t)(packet_crc >> 8);
    mb_frame[mb_frame_len - 1] = (uint8_t)(packet_crc & 0x00FF);

    if (mb_txpin >= 0)
    {
        digitalWrite(mb_txpin, HIGH);
        delayMicroseconds(mb_t35);
    }

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (mb_serialport == &Serial3) // RS485 serial port
            Controllino_RS485TxEnable(); // Enable RS485 chip to transmit
    #elif defined(CONTROLLINO_MICRO)
        if (mb_serialport == &Serial2) {
            digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, HIGH);
            digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, HIGH);
        }
    #endif

    (*mb_serialport).write(mb_frame, mb_frame_len);
    (*mb_serialport).flush();
    delayMicroseconds(mb_t35);

    if (mb_txpin >= 0)
        digitalWrite(mb_txpin, LOW);

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (mb_serialport == &Serial3) // RS485 serial port
            Controllino_RS485RxEnable(); // Go back to receive mode after transmitted data
    #elif defined(CONTROLLINO_MICRO)
        if (mb_serialport == &Serial2) {
            digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, LOW);
            digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, LOW);
        }
    #endif
}
#endif


void process_mbpacket()
{
    uint8_t fcode  = mb_frame[1];
    // Standard Modbus fields — preserved for the non-debug FCs.
    uint16_t field1 = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
    uint16_t field2 = (uint16_t)mb_frame[4] << 8 | (uint16_t)mb_frame[5];
    void *endianness_check = &mb_frame[2];

    switch (fcode)
    {
        case MB_FC_WRITE_REG:
            //field1 = reg, field2 = value
            writeSingleRegister(field1, field2);
        break;

        case MB_FC_READ_REGS:
            //field1 = startreg, field2 = numregs
            readRegisters(field1, field2);
        break;

        case MB_FC_WRITE_REGS:
            //field1 = startreg, field2 = status
            writeMultipleRegisters(field1, field2, mb_frame[6]);
        break;

        case MB_FC_READ_COILS:
            //field1 = startreg, field2 = numregs
            readCoils(field1, field2);
        break;

        case MB_FC_READ_INPUT_STAT:
            //field1 = startreg, field2 = numregs
            readInputStatus(field1, field2);
        break;

        case MB_FC_READ_INPUT_REGS:
            //field1 = startreg, field2 = numregs
            readInputRegisters(field1, field2);
        break;

        case MB_FC_WRITE_COIL:
            //field1 = reg, field2 = status
            writeSingleCoil(field1, field2);
        break;

        case MB_FC_WRITE_COILS:
            //field1 = startreg, field2 = numoutputs
            writeMultipleCoils(field1, field2, mb_frame[6]);
        break;

        case MB_FC_DEBUG_INFO:
            debugInfo();
        break;

        case MB_FC_DEBUG_GET:
        {
            // PDU: [FC:1][arr:u8][start_elem:u16][end_elem:u16]
            uint8_t arr       = mb_frame[2];
            uint16_t startIdx = (uint16_t)mb_frame[3] << 8 | (uint16_t)mb_frame[4];
            uint16_t endIdx   = (uint16_t)mb_frame[5] << 8 | (uint16_t)mb_frame[6];
            debugGetTrace(arr, startIdx, endIdx);
        }
        break;

        case MB_FC_DEBUG_GET_LIST:
        {
            // PDU: [FC:1][count:u16][(arr:u8, elem:u16)×count]
            uint16_t numIndexes = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
            debugGetTraceList(numIndexes, &mb_frame[4]);
        }
        break;

        case MB_FC_DEBUG_SET:
        {
            // PDU: [FC:1][arr:u8][elem:u16][force:u8][len:u16][value...]
            uint8_t arr   = mb_frame[2];
            uint16_t elem = (uint16_t)mb_frame[3] << 8 | (uint16_t)mb_frame[4];
            uint8_t flag  = mb_frame[5];
            uint16_t len  = (uint16_t)mb_frame[6] << 8 | (uint16_t)mb_frame[7];
            void *value   = &mb_frame[8];
            debugSetTrace(arr, elem, flag, len, value);
        }
        break;

        case MB_FC_DEBUG_GET_MD5:
            debugGetMd5(endianness_check);
        break;

        default:
            exceptionResponse(fcode, MB_EX_ILLEGAL_FUNCTION);
    }
}


//Modbus handling functions
void readRegisters(uint16_t startreg, uint16_t numregs)
{
    //Check value (numregs)
    if (numregs < 0x0001 || numregs > 0x007D)
    {
        exceptionResponse(MB_FC_READ_REGS, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address
    if ((startreg+numregs) >= (modbus.holding_size + (2*modbus.dint_memory_size) + (4*modbus.lint_memory_size)))
    {
        exceptionResponse(MB_FC_READ_REGS, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

	//calculate the query reply message length
	mb_frame_len = 3 + (numregs * 2);
    if (mb_frame_len > MAX_MB_FRAME)
    {
        //Response message is too big for this device
        exceptionResponse(MB_FC_READ_REGS, MB_EX_SLAVE_FAILURE);
        return;
    }

    //Clean frame buffer (leave only SlaveID)
    for (int i = 1; i < mb_frame_len; i++) mb_frame[i] = 0;

    mb_frame[1] = MB_FC_READ_REGS;
    mb_frame[2] = mb_frame_len - 3;   //byte count

    uint16_t val;
    uint16_t i = 0;
    uint8_t pos = 0;
	while(numregs--)
    {
        if ((startreg + i) < modbus.holding_size)
        {
            //retrieve the value from the register bank for the current register
            val = modbus.holding[startreg + i];
        }
        else if ((startreg + i) < (modbus.holding_size + (2*modbus.dint_memory_size))) //32-bit registers
        {
            if ((startreg + i) % 2 == 0) //first word
            {
                pos = ((startreg + i) - modbus.holding_size) / 2;
                val = (uint16_t)(modbus.dint_memory[pos] >> 16);
            }
            else //second word
            {
                pos = ((startreg + i) - modbus.holding_size - 1) / 2;
                val = (uint16_t)(modbus.dint_memory[pos] & 0xffff);
            }
        }
        else //64-bit registers
        {
            if ((startreg + i) % 4 == 0) //first word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size))) / 4;
                val = (uint16_t)(modbus.lint_memory[pos] >> 48);
            }
            else if ((startreg + i) % 4 == 1) //second word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 1)) / 4;
                val = (uint16_t)((modbus.lint_memory[pos] >> 32) & 0xffff);
            }
            else if ((startreg + i) % 4 == 2) //third word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 2)) / 4;
                val = (uint16_t)((modbus.lint_memory[pos] >> 16) & 0xffff);
            }
            else //fourth word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 3)) / 4;
                val = (uint16_t)(modbus.lint_memory[pos] & 0xffff);
            }
        }

        //write the high byte of the register value
        mb_frame[3 + (i * 2)]  = val >> 8;
        //write the low byte of the register value
        mb_frame[4 + (i * 2)] = val & 0xFF;
        i++;
	}
}

void writeSingleRegister(uint16_t reg, uint16_t value)
{
    if (reg >= (modbus.holding_size + (2*modbus.dint_memory_size) + (4*modbus.lint_memory_size)))
    {
        exceptionResponse(MB_FC_WRITE_REG, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    uint8_t pos = 0;

    if (reg < modbus.holding_size)
    {
        modbus.holding[reg] = value;
    }
    else if (reg < (modbus.holding_size + (2*modbus.dint_memory_size))) //32-bit registers
    {
        if (reg % 2 == 0) //first word
        {
            pos = (reg - modbus.holding_size) / 2;
            modbus.dint_memory[pos] = modbus.dint_memory[pos] & 0x0000ffff; //zeroed first word
            modbus.dint_memory[pos] = modbus.dint_memory[pos] | ((uint32_t)value << 16); //insert first word
        }
        else //second word
        {
            pos = (reg - modbus.holding_size - 1) / 2;
            modbus.dint_memory[pos] = modbus.dint_memory[pos] & 0xffff0000;
            modbus.dint_memory[pos] = modbus.dint_memory[pos] | value;
        }

    }
    else //64-bit registers
    {
        if (reg % 4 == 0) //first word
        {
            pos = (reg - (modbus.holding_size + (2*modbus.dint_memory_size))) / 4;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0x0000ffffffffffff; //zeroed first word
            modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 48); //insert first word
        }
        else if (reg % 4 == 1) //second word
        {
            pos = (reg - (modbus.holding_size + (2*modbus.dint_memory_size) - 1)) / 4;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffff0000ffffffff;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 32);
        }
        else if (reg % 4 == 2) //third word
        {
            pos = (reg - (modbus.holding_size + (2*modbus.dint_memory_size) - 2)) / 4;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffffffff0000ffff;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 16);
        }
        else //fourth word
        {
            pos = (reg - (modbus.holding_size + (2*modbus.dint_memory_size) - 3)) / 4;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffffffffffff0000;
            modbus.lint_memory[pos] = modbus.lint_memory[pos] | value;
        }
    }
}

void writeMultipleRegisters(uint16_t startreg, uint16_t numoutputs, uint8_t bytecount)
{
    //Check value
    if (numoutputs < 0x0001 || numoutputs > 0x007B || bytecount != 2 * numoutputs)
    {
        exceptionResponse(MB_FC_WRITE_REGS, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address (startreg...startreg + numregs)
    if ((startreg + numoutputs) >= (modbus.holding_size + (2*modbus.dint_memory_size) + (4*modbus.lint_memory_size)))
    {
        exceptionResponse(MB_FC_WRITE_REGS, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //Prepare answer frame buffer
	mb_frame_len = 6;
    mb_frame[1] = MB_FC_WRITE_REGS;
    mb_frame[2] = startreg >> 8;
    mb_frame[3] = startreg & 0x00FF;
    mb_frame[4] = numoutputs >> 8;
    mb_frame[5] = numoutputs & 0x00FF;

    uint16_t value;
    uint16_t i = 0;
    uint8_t pos = 0;
	while(numoutputs--)
    {
        value = (uint16_t)mb_frame[7+i*2] << 8 | (uint16_t)mb_frame[8+i*2];

        if ((startreg + i) < modbus.holding_size)
        {
            modbus.holding[(startreg + i)] = value;
        }
        else if ((startreg + i) < (modbus.holding_size + (2*modbus.dint_memory_size))) //32-bit registers
        {
            if ((startreg + i) % 2 == 0) //first word
            {
                pos = ((startreg + i) - modbus.holding_size) / 2;
                modbus.dint_memory[pos] = modbus.dint_memory[pos] & 0x0000ffff; //zeroed first word
                modbus.dint_memory[pos] = modbus.dint_memory[pos] | ((uint32_t)value << 16); //insert first word
            }
            else //second word
            {
                pos = ((startreg + i) - modbus.holding_size - 1) / 2;
                modbus.dint_memory[pos] = modbus.dint_memory[pos] & 0xffff0000;
                modbus.dint_memory[pos] = modbus.dint_memory[pos] | value;
            }

        }
        else //64-bit registers
        {
            if ((startreg + i) % 4 == 0) //first word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size))) / 4;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0x0000ffffffffffff; //zeroed first word
                modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 48); //insert first word
            }
            else if ((startreg + i) % 4 == 1) //second word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 1)) / 4;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffff0000ffffffff;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 32);
            }
            else if ((startreg + i) % 4 == 2) //third word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 2)) / 4;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffffffff0000ffff;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] | ((uint64_t)value << 16);
            }
            else //fourth word
            {
                pos = ((startreg + i) - (modbus.holding_size + (2*modbus.dint_memory_size) - 3)) / 4;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] & 0xffffffffffff0000;
                modbus.lint_memory[pos] = modbus.lint_memory[pos] | value;
            }
        }

        i++;
	}
}

void exceptionResponse(uint16_t fcode, uint16_t excode)
{
    //Clean frame buffer (leave only SlaveID)
    mb_frame_len = 3;
    for (int i = 0; i < mb_frame_len; i++) mb_frame[i] = 0;
    mb_frame[0] = modbus.slaveid;
    mb_frame[1] = fcode + 0x80;
    mb_frame[2] = excode;
}

void readCoils(uint16_t startreg, uint16_t numregs)
{
    //Check value (numregs)
    if (numregs < 0x0001 || numregs > 0x07D0)
    {
        exceptionResponse(MB_FC_READ_COILS, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address
    if (startreg + numregs > modbus.coils_size)
    {
        exceptionResponse(MB_FC_READ_COILS, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //Determine the message length = slaveid + function type + byte count and
	//for each group of 8 registers the message length increases by 1
	mb_frame_len = 3 + numregs/8;
	if (numregs%8) mb_frame_len++; //Add 1 to the message length for the partial byte.
    if (mb_frame_len > MAX_MB_FRAME)
    {
        //Response message is too big for this device
        exceptionResponse(MB_FC_READ_COILS, MB_EX_SLAVE_FAILURE);
        return;
    }

    //Clean frame buffer (leave only SlaveID)
    for (int i = 1; i < mb_frame_len; i++) mb_frame[i] = 0;

    mb_frame[1] = MB_FC_READ_COILS;
    mb_frame[2] = mb_frame_len - 3; //byte count (mb_frame_len - slave id, function code and byte count)

    uint8_t bitn = 0;
    uint16_t totregs = numregs;
    uint16_t i;
	while (numregs)
    {
        i = (totregs - numregs--) / 8;
		if (get_discrete((uint8_t)startreg, COILS))
			bitSet(mb_frame[3+i], bitn);
		else
			bitClear(mb_frame[3+i], bitn);

		//increment the bit index
		bitn++;
		if (bitn == 8) bitn = 0;
		//increment the register
		startreg++;
	}
}

void readInputStatus(uint16_t startreg, uint16_t numregs)
{
    //Check value (numregs)
    if (numregs < 0x0001 || numregs > 0x07D0)
    {
        exceptionResponse(MB_FC_READ_INPUT_STAT, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address
    if ((startreg + numregs) > modbus.input_status_size)
    {
        exceptionResponse(MB_FC_READ_INPUT_STAT, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //Determine the message length = function type, byte count and
    //for each group of 8 registers the message length increases by 1
    mb_frame_len = 3 + numregs/8;
    if (numregs%8) mb_frame_len++; //Add 1 to the message length for the partial byte.
    if (mb_frame_len > MAX_MB_FRAME)
    {
        //Response message is too big for this device
        exceptionResponse(MB_FC_READ_INPUT_STAT, MB_EX_SLAVE_FAILURE);
        return;
    }

    //Clean frame buffer (leave only SlaveID)
    for (int i = 1; i < mb_frame_len; i++) mb_frame[i] = 0;

    mb_frame[1] = MB_FC_READ_INPUT_STAT;
    mb_frame[2] = mb_frame_len - 3;

    byte bitn = 0;
    uint16_t totregs = numregs;
    uint16_t i;
    while (numregs)
    {
        i = (totregs - numregs--) / 8;
        if (get_discrete(startreg, INPUTSTATUS))
        bitSet(mb_frame[3+i], bitn);
        else
        bitClear(mb_frame[3+i], bitn);
        //increment the bit index
        bitn++;
        if (bitn == 8) bitn = 0;
        //increment the register
        startreg++;
    }
}

void readInputRegisters(uint16_t startreg, uint16_t numregs)
{
    //Check value (numregs)
    if (numregs < 0x0001 || numregs > 0x007D)
    {
        exceptionResponse(MB_FC_READ_INPUT_REGS, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address
    if ((startreg + numregs) > modbus.input_regs_size)
    {
        exceptionResponse(MB_FC_READ_INPUT_REGS, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //calculate the query reply message length
    //for each register queried add 2 bytes
    mb_frame_len = 3 + (numregs * 2);
    if (mb_frame_len > MAX_MB_FRAME)
    {
        //Response message is too big for this device
        exceptionResponse(MB_FC_READ_INPUT_REGS, MB_EX_SLAVE_FAILURE);
        return;
    }

    //Clean frame buffer (leave only SlaveID)
    for (int i = 1; i < mb_frame_len; i++) mb_frame[i] = 0;

    mb_frame[1] = MB_FC_READ_INPUT_REGS;
    mb_frame[2] = mb_frame_len - 3;

    uint16_t val;
    uint16_t i = 0;
    while(numregs--)
    {
        //retrieve the value from the register bank for the current register
        val = modbus.input_regs[startreg + i];
        //write the high byte of the register value
        mb_frame[3 + (i * 2)]  = val >> 8;
        //write the low byte of the register value
        mb_frame[4 + (i * 2)] = val & 0xFF;
        i++;
    }
}

void writeSingleCoil(uint16_t reg, uint16_t status)
{
    //Check value (status)
    if (status != 0xFF00 && status != 0x0000)
    {
        exceptionResponse(MB_FC_WRITE_COIL, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address
    if (reg > (modbus.coils_size - 1))
    {
        exceptionResponse(MB_FC_WRITE_COIL, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //Execute
    write_discrete(reg, COILS, status == 0xFF00 ? true : false);
}

void writeMultipleCoils(uint16_t startreg, uint16_t numoutputs, uint16_t bytecount)
{
    //Check value
    uint8_t bytecount_calc = numoutputs / 8;
    if (numoutputs%8) bytecount_calc++;
    if (numoutputs < 0x0001 || numoutputs > 0x07B0 || bytecount != bytecount_calc)
    {
        exceptionResponse(MB_FC_WRITE_COILS, MB_EX_ILLEGAL_VALUE);
        return;
    }

    //Check Address (startreg...startreg + numregs)
    if ((startreg + numoutputs) > modbus.coils_size)
    {
        exceptionResponse(MB_FC_WRITE_COILS, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    //Prepare answer frame buffer
	mb_frame_len = 6;
    mb_frame[1] = MB_FC_WRITE_COILS;
    mb_frame[2] = startreg >> 8;
    mb_frame[3] = startreg & 0x00FF;
    mb_frame[4] = numoutputs >> 8;
    mb_frame[5] = numoutputs & 0x00FF;

    //Execute
    uint8_t bitn = 0;
    uint16_t totoutputs = numoutputs;
    uint16_t i;
    while (numoutputs)
    {
        i = (totoutputs - numoutputs--) / 8;
        write_discrete(startreg, COILS, bitRead(mb_frame[7+i], bitn));
        //increment the bit index
        bitn++;
        if (bitn == 8) bitn = 0;
        //increment the register
        startreg++;
    }
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_INFO function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_INFO function code.
 * The response frame includes the number of variables defined in the PLC program.
 *
 * Modbus Response Frame (DEBUG_INFO):
 * +-----+-------+-------+
 * | MB  | Count | Count |
 * | FC  |       |       |
 * +-----+-------+-------+
 * |0x41 | High  | Low   |
 * |     | Byte  | Byte  |
 * |     |       |       |
 * +-----+-------+-------+
 *
 * @return void
 */
// Phase 4 PDU:
// +-----+-------+------+-----------+-----------+-----------+
// | FC  | arrs  | stat | count_0   | count_1   | ...       |
// |0x41 | (u8)  | (u8) | (u16 BE)  | (u16 BE)  |           |
// +-----+-------+------+-----------+-----------+-----------+
// Response: [FC, arrCount, STATUS_OK, (count×arrCount as u16 BE)]
void debugInfo()
{
    uint8_t arrCount = openplc_debug_array_count();

    // Cap at what the Modbus frame can hold: 3 header bytes + 2 bytes/array.
    // Realistic projects have <=10 arrays, so this is never a real limit.
    uint8_t maxArrs = (MAX_MB_FRAME - 3) / 2;
    if (arrCount > maxArrs) arrCount = maxArrs;

    mb_frame[1] = MB_FC_DEBUG_INFO;
    mb_frame[2] = arrCount;
    mb_frame[3] = MB_DEBUG_SUCCESS;
    uint16_t pos = 4;
    for (uint8_t i = 0; i < arrCount; i++)
    {
        uint16_t c = openplc_debug_elem_count(i);
        mb_frame[pos++] = (uint8_t)(c >> 8);
        mb_frame[pos++] = (uint8_t)(c & 0xFF);
    }
    mb_frame_len = pos;
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_SET function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_SET function code.
 * The response frame indicates whether the set trace command was successful or if
 * there was an error, such as an out-of-bounds index.
 *
 * Modbus Response Frame (DEBUG_SET):
 * +-----+------+
 * | MB  | Resp.|
 * | FC  | Code |
 * +-----+------+
 * |0x42 | Code |
 * +-----+------+
 *
 * @param varidx The index of the variable to set trace for.
 * @param flag The trace flag.
 * @param len The length of the trace data.
 * @param value Pointer to the trace data.
 *
 * @return void
 */
// Phase 4 PDU: [FC, arr, elem_hi, elem_lo, force, len_hi, len_lo, value...]
// Response:    [FC, STATUS]
void debugSetTrace(uint8_t arr, uint16_t elem, uint8_t flag,
                   uint16_t len, void *value)
{
    if (len > (MAX_MB_FRAME - 8))
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_SET;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_BOUNDS;
        return;
    }

    uint8_t status = openplc_debug_set(
        arr, elem, (uint8_t)flag, (const uint8_t *)value, len);

    mb_frame_len = 3;
    mb_frame[1] = MB_FC_DEBUG_SET;
    mb_frame[2] = status;
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_GET function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_GET function code.
 * The response frame includes the trace data for variables within the specified index range.
 *
 * Modbus Response Frame (DEBUG_GET):
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * | MB  | Resp. | Last  | Last  | Tick  | Tick  | Tick  | Tick  | Resp. | Resp.| Data  |
 * | FC  | Code  | Index | Index |       |       |       |       | Size  | Size | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * |0x44 | Code  | High  | Low   | High  | Mid   | Mid   | Low   | High  | Low  | Data  |
 * |     |       | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 *
 * @param startidx The start index of the variables to get trace for.
 * @param endidx The end index of the variables to get trace for.
 *
 * @return void
 */
// Phase 4 PDU: [FC, arr, start_hi, start_lo, end_hi, end_lo]
// Response: [FC, STATUS, last_elem_hi, last_elem_lo,
//            tick_hi, tick_mh, tick_ml, tick_lo,
//            size_hi, size_lo, data...]
void debugGetTrace(uint8_t arr, uint16_t startidx, uint16_t endidx)
{
    uint16_t arrCount = openplc_debug_elem_count(arr);
    if (arrCount == 0 || startidx >= arrCount ||
        endidx >= arrCount || startidx > endidx)
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_GET;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_BOUNDS;
        return;
    }

    uint16_t lastElemIdx = startidx;
    uint16_t responseSize = 0;
    uint8_t *responsePtr = &(mb_frame[11]);

    for (uint16_t elem = startidx; elem <= endidx; elem++)
    {
        uint16_t varSize = openplc_debug_size(arr, elem);
        // Bounds check — stop packing if this one won't fit.
        if ((11 + responseSize + varSize) > MAX_MB_FRAME) break;
        if (varSize == 0) {
            // Entry has no readable bytes (string stub / out-of-bounds)
            // — skip gracefully to keep the scan progressing.
            lastElemIdx = elem;
            continue;
        }
        uint16_t n = openplc_debug_read(arr, elem, responsePtr);
        if (n == 0) {
            lastElemIdx = elem;
            continue;
        }
        responsePtr += n;
        responseSize += n;
        lastElemIdx = elem;
    }

    mb_frame_len = 11 + responseSize;
    mb_frame[1] = MB_FC_DEBUG_GET;
    mb_frame[2] = MB_DEBUG_SUCCESS;
    mb_frame[3] = (uint8_t)(lastElemIdx >> 8);
    mb_frame[4] = (uint8_t)(lastElemIdx & 0xFF);
    mb_frame[5] = (uint8_t)((scan_counter >> 24) & 0xFF);
    mb_frame[6] = (uint8_t)((scan_counter >> 16) & 0xFF);
    mb_frame[7] = (uint8_t)((scan_counter >> 8)  & 0xFF);
    mb_frame[8] = (uint8_t)(scan_counter & 0xFF);
    mb_frame[9]  = (uint8_t)(responseSize >> 8);
    mb_frame[10] = (uint8_t)(responseSize & 0xFF);
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_GET_LIST function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_GET_LIST function code.
 * The response frame includes the trace data for variables specified in the provided index list.
 *
 * Modbus Response Frame (DEBUG_GET_LIST):
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * | MB  | Resp. | Last  | Last  | Tick  | Tick  | Tick  | Tick  | Resp. | Resp.| Data  |
 * | FC  | Code  | Index | Index |       |       |       |       | Size  | Size | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * |0x44 | Code  | High  | Low   | High  | Mid   | Mid   | Low   | High  | Low  | Data  |
 * |     |       | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 *
 * @param numIndexes The number of indexes requested.
 * @param indexArray Pointer to the array containing variable indexes.
 *
 * @return void
 */
// Phase 4 PDU: [FC, count_hi, count_lo, (arr:u8, elem_hi, elem_lo)×count]
// Response: [FC, STATUS, last_idx_hi, last_idx_lo,
//            tick_hi, tick_mh, tick_ml, tick_lo,
//            size_hi, size_lo, data...]
// last_idx is the index *into the request list* that was last successfully
// included — the editor uses it to retry from the next item on overflow.
void debugGetTraceList(uint16_t numIndexes, uint8_t *indexArray)
{
    uint16_t response_idx = 11;
    uint16_t responseSize = 0;
    uint16_t lastReqIdx = 0;

    #ifdef MBSERIAL
        #define VARIDX_SIZE 20
    #else
        #define VARIDX_SIZE 60
    #endif

    if (numIndexes > VARIDX_SIZE)
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_GET_LIST;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_MEMORY;
        return;
    }

    // The request indexArray (at mb_frame[4..]) and the response buffer
    // (mb_frame[11..]) overlap. Once handle_read writes the first response
    // byte, later index entries inside mb_frame are clobbered. Snapshot the
    // request first.
    uint8_t localIndex[VARIDX_SIZE * 3];
    for (uint16_t i = 0; i < numIndexes * 3; i++) {
        localIndex[i] = indexArray[i];
    }

    // Each address pair is 3 bytes: [arr:u8, elem_hi, elem_lo]
    for (uint16_t i = 0; i < numIndexes; i++)
    {
        uint8_t  arr  = localIndex[i * 3];
        uint16_t elem = (uint16_t)localIndex[i * 3 + 1] << 8 |
                         (uint16_t)localIndex[i * 3 + 2];

        uint16_t varSize = openplc_debug_size(arr, elem);
        if (varSize == 0)
        {
            // Out-of-bounds or string stub — skip gracefully.
            lastReqIdx = i;
            continue;
        }
        if ((response_idx + varSize) > MAX_MB_FRAME) break;

        uint16_t n = openplc_debug_read(arr, elem, &mb_frame[response_idx]);
        if (n == 0)
        {
            lastReqIdx = i;
            continue;
        }
        response_idx += n;
        responseSize += n;
        lastReqIdx = i;
    }

    mb_frame_len = response_idx;
    mb_frame[1] = MB_FC_DEBUG_GET_LIST;
    mb_frame[2] = MB_DEBUG_SUCCESS;
    mb_frame[3] = (uint8_t)(lastReqIdx >> 8);
    mb_frame[4] = (uint8_t)(lastReqIdx & 0xFF);
    mb_frame[5] = (uint8_t)((scan_counter >> 24) & 0xFF);
    mb_frame[6] = (uint8_t)((scan_counter >> 16) & 0xFF);
    mb_frame[7] = (uint8_t)((scan_counter >> 8)  & 0xFF);
    mb_frame[8] = (uint8_t)(scan_counter & 0xFF);
    mb_frame[9]  = (uint8_t)(responseSize >> 8);
    mb_frame[10] = (uint8_t)(responseSize & 0xFF);
}

// PDU request:  [FC, endian_check_hi, endian_check_lo]
// PDU response: [FC, STATUS, md5_ascii..., endian_marker_hi, endian_marker_lo]
//
// The target always writes variable data in native byte order — STruC++ does
// no server-side byte-order adaptation, force/read is pure memcpy.  To let
// the editor detect what "native" means here, the MD5 response trailer
// writes the literal value 0xDEAD via a native `uint16_t*` store.  The
// bytes that land in the response are therefore in the target's native
// byte order:
//
//     LE target  →  trailer bytes = [0xAD, 0xDE]
//     BE target  →  trailer bytes = [0xDE, 0xAD]
//
// The editor inspects those two bytes after MD5 verification and decides
// whether subsequent force/read traffic needs byte-swapping at its end.
//
// The probe bytes the editor sends are intentionally ignored — the trailer
// is a runtime-driven sentinel, not an echo.  The argument stays in the
// signature for ABI compatibility with the dispatcher.
void debugGetMd5(void * /*endianness*/)
{
    mb_frame[1] = MB_FC_DEBUG_GET_MD5;
    mb_frame[2] = MB_DEBUG_SUCCESS;

    const char md5[] = PROGRAM_MD5;
    int md5_len = 0;
    for (md5_len = 0; md5[md5_len] != '\0'; md5_len++)
    {
        mb_frame[md5_len + 3] = md5[md5_len];
    }

    // Native-order store of the endianness sentinel.  Written byte-wise
    // (not via `*reinterpret_cast<uint16_t*>`) because `md5_len + 3` is an
    // odd offset for a 32-char MD5, and a typed 16-bit store there is an
    // unaligned access that HardFaults on Cortex-M0+ (SAMD21: MKR Zero /
    // P1AM-100) — hanging the device on the first debugger request. Copying
    // the two bytes of a native-order uint16_t preserves the target's byte
    // ordering (the signal the editor uses to choose its swap behaviour)
    // while keeping every access byte-aligned.
    const uint16_t endian_sentinel = 0xDEAD;
    const uint8_t *sentinel_bytes = reinterpret_cast<const uint8_t *>(&endian_sentinel);
    mb_frame[md5_len + 3] = sentinel_bytes[0];
    mb_frame[md5_len + 4] = sentinel_bytes[1];
    mb_frame_len = md5_len + 5;
}

uint16_t calcCrc()
{
    uint8_t CRCHi = 0xFF, CRCLo = 0x0FF, Index;

    int i = 0;
    Index = CRCHi ^ mb_frame[i];
    CRCHi = CRCLo ^ _auchCRCHi[Index];
    CRCLo = _auchCRCLo[Index];
    i++;

    while (i < (mb_frame_len - 2))
    {
        Index = CRCHi ^ mb_frame[i];
        i++;
        CRCHi = CRCLo ^ _auchCRCHi[Index];
        CRCLo = _auchCRCLo[Index];
    }

    return ((uint16_t)CRCHi << 8) | (uint16_t)CRCLo;
}


