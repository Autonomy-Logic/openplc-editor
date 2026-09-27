/**
 * Which boards RTOS mode is offered on.
 *
 * What these pin: support follows the Arduino CORE (every ESP32 has FreeRTOS,
 * whoever made the board), a package can refuse or tune it, and a manifest can
 * never select an OS backend the firmware does not implement.
 */

import { coreFromFqbn, resolveRtosProfile, withFqbnOptions } from '../support'

describe('coreFromFqbn', () => {
  it('keeps vendor and architecture, dropping the board and its options', () => {
    expect(coreFromFqbn('esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc')).toBe('esp32:esp32')
    expect(coreFromFqbn('arduino:avr:mega')).toBe('arduino:avr')
  })

  it('has no core for anything that is not an FQBN', () => {
    expect(coreFromFqbn(undefined)).toBeUndefined()
    expect(coreFromFqbn('')).toBeUndefined()
    expect(coreFromFqbn('esp32')).toBeUndefined()
  })
})

describe('resolveRtosProfile', () => {
  it('gives every ESP32 core FreeRTOS on a 1 ms tick', () => {
    expect(resolveRtosProfile('esp32:esp32', undefined)).toEqual({
      backend: 'freertos-esp32',
      tickNs: 1_000_000,
      workLevels: 8,
      maxTasks: 8,
      threads: 'native',
    })
  })

  it('offers nothing on a core without a backend', () => {
    expect(resolveRtosProfile('arduino:avr', undefined)).toBeUndefined()
    expect(resolveRtosProfile('esp8266:esp8266', undefined)).toBeUndefined()
    expect(resolveRtosProfile(undefined, undefined)).toBeUndefined()
  })

  it('honours a package refusing it', () => {
    expect(resolveRtosProfile('esp32:esp32', false)).toBeUndefined()
  })

  it('lets a package raise it on a core the table does not list, with a real backend', () => {
    expect(resolveRtosProfile('vendor:custom', { backend: 'freertos-esp32' })).toEqual({
      backend: 'freertos-esp32',
      tickNs: 1_000_000,
      workLevels: 8,
      maxTasks: 8,
      threads: 'native',
    })
  })

  it('ignores a backend the firmware does not implement', () => {
    // The manifest is external data: a typo or a future backend name must not
    // select code that does not exist, nor unset the one the core has.
    expect(resolveRtosProfile('vendor:custom', { backend: 'nuttx' })).toBeUndefined()
    expect(resolveRtosProfile('esp32:esp32', { backend: 'nuttx' })?.backend).toBe('freertos-esp32')
    expect(resolveRtosProfile('esp32:esp32', 'yes')?.backend).toBe('freertos-esp32')
  })

  it('keeps the backend’s own tick whatever a package declares', () => {
    // The firmware ticks at the RTOS's rate; a declared tick would only let the
    // editor accept periods the device then rounds.
    expect(resolveRtosProfile('esp32:esp32', { tickNs: 250_000 })?.tickNs).toBe(1_000_000)
  })
})

describe('RTOS mode beyond the ESP32', () => {
  it('gives each IEC task a thread through the RTOS where the toolchain has no <mutex>', () => {
    for (const [core, board, backend] of [
      ['arduino:mbed_nano', 'nano33ble', 'mbed-rtx'],
      ['arduino:mbed_giga', 'giga', 'mbed-rtx'],
      ['arduino:zephyr', 'unoq', 'zephyr'],
      ['STMicroelectronics:stm32', 'GenF4', 'freertos-stm32'],
      ['rp2040:rp2040', 'rpipico', 'freertos-rp2040'],
      ['arduino:renesas_uno', 'unor4wifi', 'freertos-renesas'],
      ['arduino:samd', 'mkrwifi1010', 'freertos-samd'],
    ] as const) {
      expect(resolveRtosProfile(core, undefined, `${core}:${board}`)).toMatchObject({ backend, threads: 'platform' })
    }
    expect(resolveRtosProfile('arduino:esp32', undefined)).toMatchObject({
      backend: 'freertos-esp32',
      threads: 'native',
    })
  })

  it('ticks at the RTOS’s own rate and names a library the RTOS comes as', () => {
    expect(resolveRtosProfile('arduino:zephyr', undefined, 'arduino:zephyr:unoq')?.tickNs).toBe(100_000)
    expect(resolveRtosProfile('arduino:zephyr', undefined, 'arduino:zephyr:ventunoq')?.tickNs).toBe(100_000)
    expect(resolveRtosProfile('STMicroelectronics:stm32', undefined, 'STMicroelectronics:stm32:GenF4')?.library).toBe(
      'STM32duino FreeRTOS',
    )
  })

  it('keeps the F1 and the Cortex-M0/M0+ STM32 families out, by generic board or by part', () => {
    const stm32 = (fqbn: string) => resolveRtosProfile('STMicroelectronics:stm32', undefined, fqbn)
    for (const board of ['GenF0', 'GenF1', 'GenL0', 'GenG0', 'GenC0', 'GenU0', 'GenWB0', 'GenWL3']) {
      expect(stm32(`STMicroelectronics:stm32:${board}`)).toBeUndefined()
    }
    for (const part of ['NUCLEO_F103RB', 'NUCLEO_L053R8', 'NUCLEO_G0B1RE', 'NUCLEO_WB09KE', 'STM32C0316_DK']) {
      expect(stm32(`STMicroelectronics:stm32:Nucleo_64:pnum=${part},upload_method=swdMethod`)).toBeUndefined()
    }
    expect(stm32('STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE')).toMatchObject({ maxTasks: 4 })
    expect(stm32('STMicroelectronics:stm32:Nucleo_144:pnum=NUCLEO_F446ZE')).toMatchObject({ maxTasks: 4 })
    expect(stm32('STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_WB55RG')).toMatchObject({ maxTasks: 4 })
  })

  it('offers Zephyr only on the boards whose tick the firmware checks against', () => {
    // The core's other boards tick at 32768 Hz, which the firmware's tick check refuses.
    expect(resolveRtosProfile('arduino:zephyr', undefined, 'arduino:zephyr:nano33ble')).toBeUndefined()
    expect(resolveRtosProfile('arduino:zephyr', undefined)).toBeUndefined()
  })

  it('lets the core decide the RTOS: a package cannot name another backend for it', () => {
    // The ESP32's shim cannot drive an STM32: the declaration is ignored.
    expect(
      resolveRtosProfile('STMicroelectronics:stm32', { backend: 'freertos-esp32' }, 'STMicroelectronics:stm32:GenF4'),
    ).toMatchObject({
      backend: 'freertos-stm32',
    })
    // Naming the core's own backend turns it on for a board the table leaves out.
    expect(
      resolveRtosProfile('STMicroelectronics:stm32', { backend: 'freertos-stm32' }, 'STMicroelectronics:stm32:GenF0')
        ?.backend,
    ).toBe('freertos-stm32')
    // A core the table does not list takes the package's word.
    expect(resolveRtosProfile('acme:esp32fork', { backend: 'freertos-esp32' }, 'acme:esp32fork:x')?.backend).toBe(
      'freertos-esp32',
    )
  })

  it('says where each backend takes its stacks from, for the build’s RAM check', () => {
    expect(resolveRtosProfile('arduino:samd', undefined, 'arduino:samd:mkrwifi1010')).toMatchObject({
      fixedHeap: true,
      ownDispatcher: true,
    })
    expect(resolveRtosProfile('STMicroelectronics:stm32', undefined, 'STMicroelectronics:stm32:GenF4')).toMatchObject({
      ownDispatcher: true,
    })
    expect(resolveRtosProfile('esp32:esp32', undefined, 'esp32:esp32:esp32s3')?.ownDispatcher).toBeUndefined()
  })
})

describe('the Pico family', () => {
  it('runs FreeRTOS SMP on every arduino-pico board, selected through the core menu', () => {
    for (const board of ['rpipico', 'rpipicow', 'rpipico2', 'rpipico2w']) {
      expect(resolveRtosProfile('rp2040:rp2040', undefined, `rp2040:rp2040:${board}`)).toMatchObject({
        backend: 'freertos-rp2040',
        threads: 'platform',
        boardOptions: { os: 'freertos' },
      })
    }
  })
})

describe('withFqbnOptions', () => {
  it('adds an option to a board that has none', () => {
    expect(withFqbnOptions('rp2040:rp2040:rpipico', { os: 'freertos' })).toBe('rp2040:rp2040:rpipico:os=freertos')
  })

  it('keeps the board’s own options and replaces one under the same key', () => {
    expect(withFqbnOptions('rp2040:rp2040:rpipico2:arch=riscv', { os: 'freertos' })).toBe(
      'rp2040:rp2040:rpipico2:arch=riscv,os=freertos',
    )
    expect(withFqbnOptions('rp2040:rp2040:rpipico:os=none,usbstack=picosdk', { os: 'freertos' })).toBe(
      'rp2040:rp2040:rpipico:os=freertos,usbstack=picosdk',
    )
  })

  it('reads options joined by a colon, and writes them the way arduino-cli takes them', () => {
    expect(withFqbnOptions('arduino:avr:nano:cpu=atmega328old:x=1', { os: 'freertos' })).toBe(
      'arduino:avr:nano:cpu=atmega328old,x=1,os=freertos',
    )
  })

  it('leaves the name alone with nothing to add, or when it is not a full board name', () => {
    expect(withFqbnOptions('esp32:esp32:esp32s3:CDCOnBoot=cdc', undefined)).toBe('esp32:esp32:esp32s3:CDCOnBoot=cdc')
    expect(withFqbnOptions('esp32:esp32:esp32s3', {})).toBe('esp32:esp32:esp32s3')
    expect(withFqbnOptions('rp2040:rp2040', { os: 'freertos' })).toBe('rp2040:rp2040')
  })
})

describe('the 32 KB boards', () => {
  it('builds the Uno R4’s FreeRTOS with mutexes, time slicing and a larger heap', () => {
    const profile = resolveRtosProfile('arduino:renesas_uno', undefined, 'arduino:renesas_uno:unor4wifi')
    expect(profile).toMatchObject({ backend: 'freertos-renesas', maxTasks: 1 })
    expect(profile?.defines).toEqual(
      expect.arrayContaining(['configUSE_MUTEXES=1', 'configUSE_RECURSIVE_MUTEXES=1', 'configUSE_TIME_SLICING=1']),
    )
  })

  it('installs FreeRTOS for the SAMD boards', () => {
    expect(resolveRtosProfile('arduino:samd', undefined, 'arduino:samd:mkrwifi1010')).toMatchObject({
      backend: 'freertos-samd',
      maxTasks: 2,
      library: 'FreeRTOS_SAMD21',
    })
  })
})
