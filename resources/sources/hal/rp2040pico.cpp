#include <stdlib.h>
extern "C" {
#include "openplc.h"
}
#include "Arduino.h"
#include "../examples/Baremetal/defines.h"
#include "RP2040_PWM.h"

//OpenPLC HAL for Raspberry Pi Pico/Pico W with the RP2040

/******************PINOUT CONFIGURATION***********************
Digital In:  6, 7 ,8, 9, 10, 11, 12, 13      (%IX0.0 - %IX0.7)
Digital Out: 14, 15, 16, 17, 18, 19, 20, 21  (%QX0.0 - %QX0.7)
Analog In: A1, A2, A3 (26,27,28)             (%IW0 - %IW2)
Analog Out: 4,5                              (%QW0 - %QW1)
**************************************************************/

// Arduino wiring - https://arduino-pico.readthedocs.io/en/latest/analog.html
// RP2040_PWM - https://github.com/khoih-prog/RP2040_PWM
// PWM settings
#define PWM_FREQ 10000.0f
#define PWM_BITS 16
#define PWM_RANGE 65535 // can be from 16-65535
RP2040_PWM *PWM[NUM_ANALOG_OUTPUT]; 
bool PWM_block[NUM_ANALOG_OUTPUT]; //track which pins use the PWM_CONTROLLER block

//this call is required for the C-based PWM block on the Editor
extern "C" uint8_t set_hardware_pwm(uint8_t, float, float);

//Create the I/O pin masks
uint8_t pinMask_DIN[] = {PINMASK_DIN};
uint8_t pinMask_AIN[] = {PINMASK_AIN};
uint8_t pinMask_DOUT[] = {PINMASK_DOUT};
uint8_t pinMask_AOUT[] = {PINMASK_AOUT}; //2,3 can be used if SPI not required

float pwm_freq = PWM_FREQ;
bool toggle = true;

// called by the PWM_CONTROLLER
uint8_t set_hardware_pwm(uint8_t ch, float freq, float duty)
{
    if (ch >= NUM_ANALOG_OUTPUT) return 0;

    //range check 
    duty = duty < 0 ? 0 : duty > 100 ? 100 : duty;

    //using the RP2040_PWM library
    if (PWM[ch]->setPWM_Int(pinMask_AOUT[ch],freq, duty * 1000))
    {   
        PWM_block[ch] = true; //this channel is using the block
        pwm_freq = freq;
        return 1;
    }

    return 0;
}

void hardwareInit()
{
    // set the analog input resolution to 12bit
    analogReadResolution(12);
    pinMode(25, OUTPUT);

    //Arduino wiring library without using the defaults
    /*
    analogWriteFreq(PWM_FREQ); 
    analogWriteRange(PWM_RANGE); 
    analogWriteResolution(PWM_BITS);
    //*/

    for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
    {
        pinMode(pinMask_DIN[i], INPUT);
    }
    for (int i = 0; i < NUM_ANALOG_INPUT; i++)
    {
        pinMode(pinMask_AIN[i], INPUT);
    }
    for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
    {
        pinMode(pinMask_DOUT[i], OUTPUT);
    }
    for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
    {
        //using the RP2040_PWM library
        PWM_block[i] = false; //assume no blocks used
        PWM[i] = new RP2040_PWM(pinMask_AOUT[i], PWM_FREQ, 0); 
        if (PWM[i] )  PWM[i] ->setPWM();
    
        //Arduino wiring library
        //pinMode(pinMask_AOUT[i], OUTPUT);
    }
}

void updateInputBuffers()
{
    for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
    {
        if (bool_input[i/8][i%8] != NULL) 
            *bool_input[i/8][i%8] = digitalRead(pinMask_DIN[i]);
    }
    for (int i = 0; i < NUM_ANALOG_INPUT; i++)
    {
        if (int_input[i] != NULL)
          *int_input[i] = analogRead(pinMask_AIN[i]);
    }
}

void updateOutputBuffers()
{
    uint32_t duty = 0;    
   

    for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] != NULL) 
            digitalWrite(pinMask_DOUT[i], *bool_output[i/8][i%8]);
    }

    for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
    {
        int _duty = 0;
        if (int_output[i] != NULL) 
        {
            // The analogWrite line assumes arduino defaults without library without
            // analogWriteFreq, analogWriteRange, analogWriteResolution
            //analogWrite(pinMask_AOUT[i], (*int_output[i])/256);
            
            _duty = *int_output[i];
            _duty = _duty < 0 ? 0 : _duty > PWM_RANGE ? PWM_RANGE : _duty;

            //using the RP2040_PWM library
            if (PWM_block[i] == false) //only pins not using the PWM_CONTROLLER block
            {  
               duty = map(_duty,0,65535,0,100);             
               PWM[i]->setPWM_Int(pinMask_AOUT[i], pwm_freq, duty*1000);
            }

            //Arduino wiring library
            //analogWrite(pinMask_AOUT[i], _duty);
        }  
    }
}
