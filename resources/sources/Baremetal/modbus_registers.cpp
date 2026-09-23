/*
modbus_registers.cpp - Modbus operation function codes, served from the process image
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_registers.h"

#include "arduino_runtime_glue.h"

// The operation FCs only exist when full Modbus is enabled. In a debug-only
// build this whole TU compiles to nothing, saving flash/SRAM.
#ifdef MODBUS_ENABLED

// ---------------------------------------------------------------------------
// This layer owns no storage: every FC addresses the process image through
// openplc_image_*. The register map, which clients depend on:
//
//   coils (0x01/0x05/0x0F)            %QX, by bit
//   discrete inputs (0x02)            %IX, by bit
//   input registers (0x04)            %IW, one register each
//   holding registers (0x03/0x06/0x10)
//       [0, n_qw)                     %QW, one register each
//       [n_qw, n_qw+n_mw)             %MW, one register each
//       then %MD                      two registers each, HIGH word first
//       then %ML                      four registers each, highest word first
//
// A slot with nothing bound reads 0 and swallows writes.
// ---------------------------------------------------------------------------

static inline uint16_t area_count(openplc_image_area_t area)
{
    return openplc_image_count(area);
}

/** Registers the holding space spans. */
static uint16_t holding_span(void)
{
    return (uint16_t)(area_count(OPENPLC_AREA_INT_OUTPUT) +
                      area_count(OPENPLC_AREA_INT_MEMORY) +
                      (2 * area_count(OPENPLC_AREA_DINT_MEMORY)) +
                      (4 * area_count(OPENPLC_AREA_LINT_MEMORY)));
}

/** Which image slot, and which 16-bit word of it, a holding register is. */
typedef struct {
    openplc_image_area_t area;
    uint16_t index;   /* element index within the area */
    uint8_t  word;    /* 0 = most significant word of the element */
} mb_holding_ref_t;

/** Resolve a holding register address, or false past the end. The word offset
 *  is relative to the REGION: absolute-address parity only agrees with it when
 *  %QW + %MW is even, and swapped the words of every %MD when it was odd. */
static bool holding_ref(uint16_t reg, mb_holding_ref_t* out)
{
    const uint16_t n_qw = area_count(OPENPLC_AREA_INT_OUTPUT);
    const uint16_t n_mw = area_count(OPENPLC_AREA_INT_MEMORY);
    const uint16_t n_md = area_count(OPENPLC_AREA_DINT_MEMORY);
    const uint16_t n_ml = area_count(OPENPLC_AREA_LINT_MEMORY);

    const uint16_t base_md = (uint16_t)(n_qw + n_mw);
    const uint16_t base_ml = (uint16_t)(base_md + (2 * n_md));
    const uint16_t end     = (uint16_t)(base_ml + (4 * n_ml));

    if (reg < n_qw) {
        out->area = OPENPLC_AREA_INT_OUTPUT;
        out->index = reg;
        out->word = 0;
        return true;
    }
    if (reg < base_md) {
        out->area = OPENPLC_AREA_INT_MEMORY;
        out->index = (uint16_t)(reg - n_qw);
        out->word = 0;
        return true;
    }
    if (reg < base_ml) {
        const uint16_t off = (uint16_t)(reg - base_md);
        out->area = OPENPLC_AREA_DINT_MEMORY;
        out->index = (uint16_t)(off / 2);
        out->word = (uint8_t)(off % 2);
        return true;
    }
    if (reg < end) {
        const uint16_t off = (uint16_t)(reg - base_ml);
        out->area = OPENPLC_AREA_LINT_MEMORY;
        out->index = (uint16_t)(off / 4);
        out->word = (uint8_t)(off % 4);
        return true;
    }
    return false;
}

/** Shift of word `word` in a `width`-byte element, word 0 being the most
 *  significant -- the order the wire uses. */
static inline uint8_t word_shift(uint8_t width, uint8_t word)
{
    return (uint8_t)(16 * (((width / 2) - 1) - word));
}

static uint16_t holding_read(uint16_t reg)
{
    mb_holding_ref_t ref;
    if (!holding_ref(reg, &ref)) return 0;

    uint8_t width = 0;
    void* p = openplc_image_slot(ref.area, ref.index, &width);
    if (p == NULL) return 0;

    switch (width) {
    case 2: return *(const uint16_t*)p;
    case 4: return (uint16_t)(*(const uint32_t*)p >> word_shift(4, ref.word));
    case 8: return (uint16_t)(*(const uint64_t*)p >> word_shift(8, ref.word));
    default: return 0;
    }
}

static void holding_write(uint16_t reg, uint16_t value)
{
    mb_holding_ref_t ref;
    if (!holding_ref(reg, &ref)) return;

    uint8_t width = 0;
    void* p = openplc_image_slot(ref.area, ref.index, &width);
    if (p == NULL) return;   // nothing bound here: the write is dropped

    switch (width) {
    case 2:
        *(uint16_t*)p = value;
        break;
    case 4: {
        // Read-modify-write: a client may send the two words in separate
        // requests, so the other one has to survive.
        const uint8_t shift = word_shift(4, ref.word);
        uint32_t* slot = (uint32_t*)p;
        *slot = (uint32_t)((*slot & ~((uint32_t)0xFFFF << shift)) | ((uint32_t)value << shift));
        break;
    }
    case 8: {
        const uint8_t shift = word_shift(8, ref.word);
        uint64_t* slot = (uint64_t*)p;
        *slot = (uint64_t)((*slot & ~((uint64_t)0xFFFF << shift)) | ((uint64_t)value << shift));
        break;
    }
    default:
        break;
    }
}

// The image stores one IEC_BOOL per bit; only the wire packs them.
bool get_discrete(uint16_t addr, bool regtype)
{
    const uint8_t* p = openplc_image_bit(
        regtype == COILS ? OPENPLC_AREA_BOOL_OUTPUT : OPENPLC_AREA_BOOL_INPUT, addr);
    return (p != NULL) && (*p != 0);
}

void write_discrete(uint16_t addr, bool regtype, bool value)
{
    uint8_t* p = openplc_image_bit(
        regtype == COILS ? OPENPLC_AREA_BOOL_OUTPUT : OPENPLC_AREA_BOOL_INPUT, addr);
    if (p != NULL) *p = value ? 1 : 0;
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
    if ((uint32_t)startreg + numregs > holding_span())
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

    uint16_t i = 0;
	while(numregs--)
    {
        const uint16_t val = holding_read((uint16_t)(startreg + i));
        //write the high byte of the register value
        mb_frame[3 + (i * 2)]  = val >> 8;
        //write the low byte of the register value
        mb_frame[4 + (i * 2)] = val & 0xFF;
        i++;
	}
}

void writeSingleRegister(uint16_t reg, uint16_t value)
{
    if (reg >= holding_span())
    {
        exceptionResponse(MB_FC_WRITE_REG, MB_EX_ILLEGAL_ADDRESS);
        return;
    }

    holding_write(reg, value);
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
    if ((uint32_t)startreg + numoutputs > holding_span())
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

    uint16_t i = 0;
	while(numoutputs--)
    {
        const uint16_t value = (uint16_t)mb_frame[7+i*2] << 8 | (uint16_t)mb_frame[8+i*2];
        holding_write((uint16_t)(startreg + i), value);
        i++;
	}
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
    if ((uint32_t)startreg + numregs > area_count(OPENPLC_AREA_BOOL_OUTPUT))
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
		if (get_discrete(startreg, COILS))
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
    if ((uint32_t)startreg + numregs > area_count(OPENPLC_AREA_BOOL_INPUT))
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
    if ((uint32_t)startreg + numregs > area_count(OPENPLC_AREA_INT_INPUT))
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

    uint16_t i = 0;
    while(numregs--)
    {
        uint8_t width = 0;
        const void* p = openplc_image_slot(OPENPLC_AREA_INT_INPUT, (uint16_t)(startreg + i), &width);
        const uint16_t val = (p != NULL) ? *(const uint16_t*)p : 0;
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

    //Check Address. Against the count, not `count - 1`, which wrapped to
    //0xFFFF on an image with no coils and accepted every address.
    if (reg >= area_count(OPENPLC_AREA_BOOL_OUTPUT))
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
    if ((uint32_t)startreg + numoutputs > area_count(OPENPLC_AREA_BOOL_OUTPUT))
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

#endif // MODBUS_ENABLED
