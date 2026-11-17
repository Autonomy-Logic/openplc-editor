import { hmiDebugPath, hmiTagResolver } from '../tag-resolver'

const INSTANCES = [
  { name: 'instance0', program: 'Main' },
  { name: 'Pump1', program: 'PumpCtl' },
]

const debugMap = (leaves: Array<[string, number, number]>): string =>
  JSON.stringify({
    version: 2,
    md5: 'x',
    leaves: leaves.map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'INT', size: 2 })),
  })

describe('hmiDebugPath', () => {
  it.each([
    ['CONFIG0.RES0.INSTANCE0.MAIN.LEVEL', 'INSTANCE0.LEVEL'],
    ['CONFIG0.RES0.PUMP1.PUMPCTL.F.Q', 'PUMP1.F.Q'],
    ['CONFIG0.RES0.INSTANCE0.MAIN.ARR[1]', 'INSTANCE0.ARR[1]'],
    ['CONFIG0.ALARMON', 'ALARMON'],
    ['GVL.MEMBER', 'GVL.MEMBER'],
    ['instance0.Main.Level', 'INSTANCE0.LEVEL'],
    ['CONFIG0.RES0.INSTANCE0. MAIN .LEVEL', 'INSTANCE0.LEVEL'],
    ['CONFIG0.RES0.INSTANCE0.MAIN.M[2,1]', 'INSTANCE0.M[2][1]'],
    ['CONFIG0.RES0.INSTANCE0.MAIN.C[0, 1, 2].X', 'INSTANCE0.C[0][1][2].X'],
    ['GVL.ARR[4]', 'GVL.ARR[4]'],
  ])('%s -> %s', (path, expected) => {
    expect(hmiDebugPath(path, INSTANCES)).toBe(expected)
  })

  it('keeps a middle part that is not the instance program type', () => {
    expect(hmiDebugPath('CONFIG0.RES0.INSTANCE0.OTHER.X', INSTANCES)).toBe('INSTANCE0.OTHER.X')
  })
})

describe('hmiTagResolver', () => {
  const resolve = hmiTagResolver(
    debugMap([
      ['INSTANCE0.LEVEL', 0, 3],
      ['instance0.arr[1]', 0, 9],
      ['ALARMON', 2, 0],
      ['GVL.MEMBER', 1, 4],
    ]),
    INSTANCES,
  )

  it('finds the debug address of each kind of variable', () => {
    expect(resolve('CONFIG0.RES0.INSTANCE0.MAIN.LEVEL')).toEqual({ arr: 0, elem: 3 })
    expect(resolve('CONFIG0.RES0.INSTANCE0.MAIN.ARR[1]')).toEqual({ arr: 0, elem: 9 })
    expect(resolve('CONFIG0.ALARMON')).toEqual({ arr: 2, elem: 0 })
    expect(resolve('GVL.MEMBER')).toEqual({ arr: 1, elem: 4 })
  })

  it('answers null for a variable the program does not have', () => {
    expect(resolve('CONFIG0.RES0.INSTANCE0.MAIN.GONE')).toBeNull()
  })

  it.each(['', 'not json', '[]', '{"leaves": 3}', '{"leaves": [{"path": 1, "arrayIdx": 0, "elemIdx": 0}]}'])(
    'resolves nothing from %j',
    (text) => {
      expect(hmiTagResolver(text, INSTANCES)('CONFIG0.ALARMON')).toBeNull()
    },
  )

  it('skips leaves without integer addresses', () => {
    const r = hmiTagResolver(
      JSON.stringify({
        leaves: [
          { path: 'A', arrayIdx: 0.5, elemIdx: 0 },
          { path: 'B', arrayIdx: 1, elemIdx: 2 },
        ],
      }),
      [],
    )
    expect(r('A')).toBeNull()
    expect(r('B')).toEqual({ arr: 1, elem: 2 })
  })
})
