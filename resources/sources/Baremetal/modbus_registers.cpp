/*
modbus_registers.cpp - Modbus register store + operation function codes
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_registers.h"

// The register banks and operation FCs only exist when full Modbus is enabled.
// In a debug-only build this whole TU compiles to nothing, saving flash/SRAM.
#ifdef MODBUS_ENABLED

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

#endif // MODBUS_ENABLED
