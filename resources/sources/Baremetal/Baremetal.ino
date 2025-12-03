#include "Arduino_OpenPLC.h"
#include "defines.h"

#ifdef MODBUS_ENABLED
#include "ModbusSlave.h"
#endif

//Include WiFi lib to turn off WiFi radio on ESP32 and ESP8266 boards if we're not using WiFi
#ifndef MBTCP
    #if defined(BOARD_ESP8266)
        #include <ESP8266WiFi.h>
    #elif defined(BOARD_ESP32)
        #include <WiFi.h>
    #endif
#endif

uint32_t __tick = 0;

unsigned long scan_cycle;
unsigned long last_run = 0;
bool first_cycle = false;

#include "arduino_libs.h"

#ifdef USE_ARDUINO_SKETCH
    #include "ext/arduino_sketch.h"
#endif

extern uint8_t pinMask_DIN[];
extern uint8_t pinMask_AIN[];
extern uint8_t pinMask_DOUT[];
extern uint8_t pinMask_AOUT[];

/*
extern "C" int availableMemory(char *);

int availableMemory(char *msg)
{
  int size = 8192; // Use 2048 with ATmega328
  byte *buf;

  while ((buf = (byte *) malloc(--size)) == NULL);

  free(buf);
  Serial.print(msg);
  Serial.println(size);
}
*/

void setupCycleDelay(unsigned long long cycle_time)
{
    scan_cycle = (uint32_t)(cycle_time/1000);
    last_run = micros();
}

void setup()
{
    //Turn off WiFi radio on ESP32 and ESP8266 boards if we're not using WiFi
    #ifndef MBTCP
        #if defined(BOARD_ESP8266) || defined(BOARD_ESP32)
            WiFi.mode(WIFI_OFF);
        #endif
    #endif
    config_init__();
    glueVars();
    hardwareInit();
	#ifdef MODBUS_ENABLED
        #ifdef MBSERIAL
	        //Config Modbus Serial (port, speed, rs485 tx pin)
            #ifdef MBSERIAL_TXPIN
                //Disable TX pin from OpenPLC hardware layer
                for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
                {
                    if (pinMask_DIN[i] == MBSERIAL_TXPIN)
                        pinMask_DIN[i] = 255;
                }
                for (int i = 0; i < NUM_ANALOG_INPUT; i++)
                {
                    if (pinMask_AIN[i] == MBSERIAL_TXPIN)
                        pinMask_AIN[i] = 255;
                }
                for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
                {
                    if (pinMask_DOUT[i] == MBSERIAL_TXPIN)
                        pinMask_DOUT[i] = 255;
                }
                for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
                {
                    if (pinMask_AOUT[i] == MBSERIAL_TXPIN)
                        pinMask_AOUT[i] = 255;
                }
                MBSERIAL_IFACE.begin(MBSERIAL_BAUD); //Initialize serial interface
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, MBSERIAL_TXPIN);
            #else
                MBSERIAL_IFACE.begin(MBSERIAL_BAUD); //Initialize serial interface
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, -1);;
            #endif

	        //Set the Slave ID
	        modbus.slaveid = MBSERIAL_SLAVE;
        #endif

        #ifdef MBTCP
        uint8_t mac[] = { MBTCP_MAC };
        uint8_t ip[] = { MBTCP_IP };
        uint8_t dns[] = { MBTCP_DNS };
        uint8_t gateway[] = { MBTCP_GATEWAY };
        uint8_t subnet[] = { MBTCP_SUBNET };

        if (sizeof(ip)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, NULL, NULL, NULL, NULL);
        else if (sizeof(dns)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, NULL, NULL, NULL);
        else if (sizeof(gateway)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, dns, NULL, NULL);
        else if (sizeof(subnet)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, dns, gateway, NULL);
        else
            mbconfig_ethernet_iface(mac, ip, dns, gateway, subnet);
        #endif

        //Add all modbus registers
        init_mbregs(MAX_ANALOG_OUTPUT + MAX_MEMORY_WORD, MAX_MEMORY_DWORD, MAX_MEMORY_LWORD, MAX_DIGITAL_OUTPUT, MAX_ANALOG_INPUT, MAX_DIGITAL_INPUT);
        mapEmptyBuffers();
	#endif

    setupCycleDelay(common_ticktime__);

    #ifdef USE_ARDUINO_SKETCH
        sketch_setup();
    #endif
}

#ifdef MODBUS_ENABLED
void mapEmptyBuffers()
{
    //Map all NULL I/O buffers to Modbus registers
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] == NULL)
        {
			bool_output[i/8][i%8] = (IEC_BOOL *)malloc(sizeof(IEC_BOOL));
			*bool_output[i/8][i%8] = 0;
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] == NULL)
        {
			int_output[i] = (IEC_UINT *)(modbus.holding + i);
        }
    }
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
    {
        if (bool_input[i/8][i%8] == NULL)
        {
            bool_input[i/8][i%8] = (IEC_BOOL *)malloc(sizeof(IEC_BOOL));
			*bool_input[i/8][i%8] = 0;
        }
    }
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
    {
        if (int_input[i] == NULL)
        {
			int_input[i] = (IEC_UINT *)(modbus.input_regs + i);
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] == NULL)
            {
                int_memory[i] = (IEC_UINT *)(modbus.holding + MAX_ANALOG_OUTPUT + i);
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] == NULL)
            {
                dint_memory[i] = (IEC_UDINT *)(modbus.dint_memory + i);
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] == NULL)
            {
                lint_memory[i] = (IEC_ULINT *)(modbus.lint_memory + i);
            }
        }
    #endif
}

void modbusTask()
{
    //Sync OpenPLC Buffers with Modbus Buffers
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] != NULL)
        {
            write_discrete(i, COILS, (bool)*bool_output[i/8][i%8]);
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] != NULL)
        {
            modbus.holding[i] = *int_output[i];
        }
    }
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
    {
        if (bool_input[i/8][i%8] != NULL)
        {
            write_discrete(i, INPUTSTATUS, (bool)*bool_input[i/8][i%8]);
        }
    }
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
    {
        if (int_input[i] != NULL)
        {
            modbus.input_regs[i] = *int_input[i];
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] != NULL)
            {
                modbus.holding[i + MAX_ANALOG_OUTPUT] = *int_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] != NULL)
            {
                modbus.dint_memory[i] = *dint_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] != NULL)
            {
                modbus.lint_memory[i] = *lint_memory[i];
            }
        }
    #endif

    //Read changes from clients
    mbtask();

    //Write changes back to OpenPLC Buffers
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] != NULL)
        {
            *bool_output[i/8][i%8] = get_discrete(i, COILS);
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] != NULL)
        {
            *int_output[i] = modbus.holding[i];
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] != NULL)
            {
                *int_memory[i] = modbus.holding[i + MAX_ANALOG_OUTPUT];
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] != NULL)
            {
                *dint_memory[i] = modbus.dint_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] != NULL)
            {
                *lint_memory[i] = modbus.lint_memory[i];
            }
        }
    #endif
}
#endif

void plcCycleTask()
{
    updateInputBuffers();
    config_run__(__tick++); //PLC Logic
    updateOutputBuffers();
    updateTime();
}

void scheduler()
{
    // Run tasks round robin - higher priority first

    plcCycleTask();

    #ifdef USE_ARDUINO_SKETCH
        sketch_loop();
    #endif

    #ifdef MODBUS_ENABLED
        modbusTask();
    #endif

    if (!first_cycle)
    {
        first_cycle = true;
        // Recalculate last_run to avoid time drift on the first cycle
        last_run = micros() - scan_cycle;
    }
}

void loop()
{
    // ignore until next scan cycle (run lower priority tasks if time permits)
    // always rely on the difference between now (aka micros() ) and the last_run,
    // which always is a positive integer number, even when micros() wraps around every 71 minutes.
    if ((micros() - last_run) >= scan_cycle)
    {
        scheduler();

        //set timer for the next scan cycle
        last_run += scan_cycle;
    }

    #ifdef MODBUS_ENABLED
    //Only run Modbus task again if we have at least 10ms gap until the next cycle
    if ((micros() - last_run) >= 10000)
    {
        modbusTask();
    }
    #endif
}
