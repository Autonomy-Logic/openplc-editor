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
#define MAX_REAL_INPUT             32
#define MAX_REAL_OUTPUT            32
#define MAX_MEMORY_WORD            20
#define MAX_MEMORY_DWORD           20
#define MAX_MEMORY_LWORD           20

extern IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8];
extern IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8];
extern IEC_UINT *int_input[MAX_ANALOG_INPUT];
extern IEC_UINT *int_output[MAX_ANALOG_OUTPUT];
/* REAL-typed I/O at %ID / %QD addresses.  Convention follows OpenPLC:
 * `%ID<n>` means a 32-bit REAL input at byte offset n.  Modules whose
 * driver wants to deliver engineering units (volts, mA, °C, …) rather
 * than raw ADC counts bind to these — see the Arduino Opta HAL for
 * the canonical example.  Declaring `VAR AT %ID<n> : DINT` is not
 * supported on arduino-cli targets; if you need integer values at %ID
 * use %MD (memory) or %IW + manual scaling on the IEC side.        */
extern IEC_REAL *real_input[MAX_REAL_INPUT];
extern IEC_REAL *real_output[MAX_REAL_OUTPUT];
extern IEC_UINT *int_memory[MAX_MEMORY_WORD];
extern IEC_UDINT *dint_memory[MAX_MEMORY_DWORD];
extern IEC_ULINT *lint_memory[MAX_MEMORY_LWORD];

#endif

/*********************/
/*  Run/stop state   */
/*********************/

// Mode-switch positions reported by hardwareStateSwitch().
#define PLC_SWITCH_STOP     0
#define PLC_SWITCH_RUN      1

// Externally visible runtime states, as reported by runtime_get_plc_state()
// and over Modbus FC 0x49.
#define PLC_STATE_STOPPED   0
#define PLC_STATE_RUNNING   1
#define PLC_STATE_ERROR     2

//Hardware Layer (implemented in arduino.cpp HAL file, compiled as extern "C")
#ifdef __cplusplus
extern "C" {
#endif
void hardwareInit();
void updateInputBuffers();
void updateOutputBuffers();

/* ---- Optional: physical mode switch ------------------------------------
 * Weak default in arduino_runtime_glue.cpp returns PLC_SWITCH_RUN, so a HAL
 * that does not define this behaves exactly as before this interface
 * existed: the runtime boots into RUNNING and the editor has full software
 * control.
 *
 * Override with a strong extern "C" definition in the HAL .cpp -- the same
 * mechanism the P1AM HAL already uses for strucpp::iec_runtime_fault.
 *
 * Called once per scan cycle, in every state, from the scan path. MUST
 * return quickly and MUST NOT block. HOW it does so is the HAL's decision:
 * a GPIO is cheap enough to read synchronously, while a switch behind a
 * slow bus (I2C expander, fieldbus backplane) should be sampled elsewhere
 * and returned here from a cached value. The runtime never polls on the
 * HAL's behalf and never imposes a sampling period.
 * ---------------------------------------------------------------------- */
uint8_t hardwareStateSwitch(void);

/* ---- Optional: state indication ----------------------------------------
 * There is no indication callback. The runtime holds the state; a HAL with
 * a status LED reads it inside updateOutputBuffers() (which the runtime
 * calls every cycle in every state, so the LED is correct from the first
 * cycle even on a board that boots into STOP) and drives its own pin. A
 * HAL with no LED reads nothing and the runtime never knows the difference.
 * ---------------------------------------------------------------------- */
uint8_t runtime_get_plc_state(void);

// Raw I/O ops provided by the VPP's open HAL; gated by the license-core.
// updateInput/OutputBuffers above come from the license-core .a (strong,
// gated wrappers) or from a weak default (license_io_weak.cpp) that maps
// them to these raw ops unenforced.
void hal_read_inputs(void);
void hal_write_outputs(void);
void hal_disable_all_outputs(void);
#ifdef __cplusplus
}
#endif

#endif
