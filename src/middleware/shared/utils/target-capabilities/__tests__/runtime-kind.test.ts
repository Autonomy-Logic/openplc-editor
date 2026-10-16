import { classifyBoardRuntime, RUNTIME_V3_BOARD_NAME } from '../runtime-kind'

describe('classifyBoardRuntime', () => {
  it('separates v3 from v4 by the board name, since both declare one compiler', () => {
    expect(classifyBoardRuntime('OpenPLC Runtime v4', 'openplc-compiler')).toMatchObject({
      isRuntimeV4: true,
      isRuntimeV3: false,
    })
    expect(classifyBoardRuntime(RUNTIME_V3_BOARD_NAME, 'openplc-compiler')).toMatchObject({
      isRuntimeV4: false,
      isRuntimeV3: true,
    })
  })

  it('classifies the simulator and arduino-cli from the compiler alone', () => {
    expect(classifyBoardRuntime('OpenPLC Simulator', 'simulator')).toMatchObject({
      isSimulator: true,
      isRuntimeV4: false,
    })
    expect(classifyBoardRuntime('Arduino Uno', 'arduino-cli')).toMatchObject({
      isSimulator: false,
      isRuntimeV3: false,
      isRuntimeV4: false,
    })
  })

  it('mirrors the compiler as boardRuntime, and reads an absent one as no runtime', () => {
    expect(classifyBoardRuntime('Arduino Uno', 'arduino-cli').boardRuntime).toBe('arduino-cli')
    expect(classifyBoardRuntime('Unresolved', undefined)).toEqual({
      boardRuntime: '',
      isSimulator: false,
      isRuntimeV3: false,
      isRuntimeV4: false,
    })
  })
})
