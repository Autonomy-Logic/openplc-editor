import { hmiRamOverflowMessage, staticRamOverflowBytes } from '../ram-overflow'

/* Linker and arduino-cli output as the toolchains print it. */
const ESP32 = [
  "/Users/u/Library/Arduino15/packages/esp32/tools/esp-x32/2511/bin/../lib/gcc/xtensa-esp-elf/14.2.0/../../../../xtensa-esp-elf/bin/ld: /private/var/folders/x/arduino/sketches/A1/Baremetal.ino.elf section `.dram0.bss' will not fit in region `dram0_0_seg'",
  '/Users/u/Library/Arduino15/packages/esp32/tools/esp-x32/2511/bin/../lib/gcc/xtensa-esp-elf/14.2.0/../../../../xtensa-esp-elf/bin/ld: DRAM segment data does not fit.',
  "/Users/u/Library/Arduino15/packages/esp32/tools/esp-x32/2511/bin/../lib/gcc/xtensa-esp-elf/14.2.0/../../../../xtensa-esp-elf/bin/ld: region `dram0_0_seg' overflowed by 74112 bytes",
  'collect2: error: ld returned 1 exit status',
].join('\n')

const ARM = [
  "/Users/u/.arduino15/packages/rp2040/tools/pqt-gcc/4.0.1/bin/../lib/gcc/arm-none-eabi/14.2.0/../../../../arm-none-eabi/bin/ld: /tmp/arduino/Baremetal.ino.elf section `.bss' will not fit in region `RAM'",
  "/Users/u/.arduino15/packages/rp2040/tools/pqt-gcc/4.0.1/bin/../lib/gcc/arm-none-eabi/14.2.0/../../../../arm-none-eabi/bin/ld: region `RAM' overflowed by 12872 bytes",
  'collect2: error: ld returned 1 exit status',
].join('\n')

const AVR = [
  'Sketch uses 3062 bytes (9%) of program storage space. Maximum is 32256 bytes.',
  'Global variables use 2601 bytes (127%) of dynamic memory, leaving -553 bytes for local variables. Maximum is 2048 bytes.',
  'Not enough memory; see https://support.arduino.cc/hc/en-us/articles/360013825179 for tips on reducing your footprint.',
  'data section exceeds available space in board',
].join('\n')

const ESP32_FLASH = [
  "/Users/u/.../xtensa-esp-elf/bin/ld: region `irom0_0_seg' overflowed by 5120 bytes",
  'collect2: error: ld returned 1 exit status',
].join('\n')

const AVR_FLASH = [
  'Sketch uses 40000 bytes (124%) of program storage space. Maximum is 32256 bytes.',
  'Sketch too big; see https://support.arduino.cc/hc/en-us/articles/360013825179 for tips on reducing it.',
].join('\n')

describe('staticRamOverflowBytes', () => {
  it('reads the bytes a data region overflowed by', () => {
    expect(staticRamOverflowBytes(ESP32)).toBe(74112)
    expect(staticRamOverflowBytes(ARM)).toBe(12872)
  })

  it("reads arduino-cli's size check", () => {
    expect(staticRamOverflowBytes(AVR)).toBe(553)
  })

  it('reports an overflow of unknown size when the linker gives no count', () => {
    expect(staticRamOverflowBytes("ld: Baremetal.ino.elf section `.bss' will not fit in region `RAM'")).toBe(0)
  })

  it('ignores code and flash overflows and other failures', () => {
    expect(staticRamOverflowBytes(ESP32_FLASH)).toBeNull()
    expect(staticRamOverflowBytes(AVR_FLASH)).toBeNull()
    expect(staticRamOverflowBytes("Baremetal.ino:12:1: error: 'foo' was not declared in this scope")).toBeNull()
    expect(staticRamOverflowBytes('')).toBeNull()
  })
})

describe('hmiRamOverflowMessage', () => {
  it('names the overflow', () => {
    expect(hmiRamOverflowMessage(ESP32)).toBe(
      "The HMI does not fit in this board's RAM (74112 bytes over). Use fewer or simpler screens, or a board with more memory.",
    )
  })

  it('leaves the amount out when it is unknown', () => {
    expect(hmiRamOverflowMessage("section `.dram0.bss' will not fit in region `dram0_0_seg'")).toBe(
      "The HMI does not fit in this board's RAM. Use fewer or simpler screens, or a board with more memory.",
    )
  })

  it('is null without a RAM overflow', () => {
    expect(hmiRamOverflowMessage(ESP32_FLASH)).toBeNull()
  })
})
