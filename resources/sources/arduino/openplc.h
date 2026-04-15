#ifndef openplc_h
#define openplc_h

#include <stdint.h>

/*********************/
/*  IEC Types defs   */
/*********************/

typedef uint8_t  IEC_BOOL;

typedef int8_t    IEC_SINT;
typedef int16_t   IEC_INT;
typedef int32_t   IEC_DINT;
typedef int64_t   IEC_LINT;

typedef uint8_t    IEC_USINT;
typedef uint16_t   IEC_UINT;
typedef uint32_t   IEC_UDINT;
typedef uint64_t   IEC_ULINT;

typedef uint8_t    IEC_BYTE;
typedef uint16_t   IEC_WORD;
typedef uint32_t   IEC_DWORD;
typedef uint64_t   IEC_LWORD;

typedef float    IEC_REAL;
typedef double   IEC_LREAL;

//OpenPLC Buffers Sizes
#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__) || defined(__AVR_ATmega32U4__) || defined(__AVR_ATmega16U4__)

#define MAX_DIGITAL_INPUT          8
#define MAX_DIGITAL_OUTPUT         32
#define MAX_ANALOG_INPUT           6
#define MAX_ANALOG_OUTPUT          32
#define MAX_MEMORY_WORD            0
#define MAX_MEMORY_DWORD           0
#define MAX_MEMORY_LWORD           0

extern IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8];
extern IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8];
extern IEC_UINT *int_input[MAX_ANALOG_INPUT];
extern IEC_UINT *int_output[MAX_ANALOG_OUTPUT];

#else

#define MAX_DIGITAL_INPUT          56
#define MAX_DIGITAL_OUTPUT         56
#define MAX_ANALOG_INPUT           32
#define MAX_ANALOG_OUTPUT          32
#define MAX_MEMORY_WORD            20
#define MAX_MEMORY_DWORD           20
#define MAX_MEMORY_LWORD           20

extern IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8];
extern IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8];
extern IEC_UINT *int_input[MAX_ANALOG_INPUT];
extern IEC_UINT *int_output[MAX_ANALOG_OUTPUT];
extern IEC_UINT *int_memory[MAX_MEMORY_WORD];
extern IEC_UDINT *dint_memory[MAX_MEMORY_DWORD];
extern IEC_ULINT *lint_memory[MAX_MEMORY_LWORD];

#endif

//Hardware Layer
void hardwareInit();
void updateInputBuffers();
void updateOutputBuffers();

#endif
