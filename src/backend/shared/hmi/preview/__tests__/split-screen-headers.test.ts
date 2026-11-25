import { screenHeaderName, splitScreenHeaders } from '../split-screen-headers'

const HEADER = [
  '#pragma once',
  'namespace hmi {',
  'class MAIN;',
  'class OTHER;',
  '',
  'class MAIN : public HMISCREEN {',
  'public:',
  '    HMILABEL A;',
  '};',
  '',
  'class OTHER : public HMISCREEN {',
  'public:',
  '    HMIBUTTON B;',
  '};',
  '',
  'class Program_HMIMAIN : public ProgramBase {',
  '};',
  '}',
  '',
].join('\n')

const files = {
  'hmi_unit.hpp': HEADER,
  'pou_MAIN.cpp': '#include "hmi_unit.hpp"\nMAIN::MAIN() {}',
  'hmi_preview_0.cpp': '#include "hmi_unit.hpp"\n// setters',
  'pou_OTHER.cpp': '#include "hmi_unit.hpp"\nOTHER::OTHER() {}',
  'hmi_unit_glue.cpp': '#include "hmi_unit.hpp"\n// glue',
}
const screens = { Main: ['pou_MAIN.cpp', 'hmi_preview_0.cpp'], Other: ['pou_OTHER.cpp'] }

describe('splitScreenHeaders', () => {
  it("gives each screen a header without the other screens' classes, and includes it from that screen's files", () => {
    const split = splitScreenHeaders(files, screens)
    const main = split[screenHeaderName('MAIN')]
    expect(main).toContain('class MAIN : public HMISCREEN {\npublic:\n    HMILABEL A;\n};')
    expect(main).not.toContain('HMIBUTTON B')
    expect(main).toContain('class OTHER;')
    expect(main).toContain('class Program_HMIMAIN : public ProgramBase {')
    expect(split[screenHeaderName('OTHER')]).not.toContain('HMILABEL A')
    expect(split['pou_MAIN.cpp']).toBe('#include "hmi_screen_MAIN.hpp"\nMAIN::MAIN() {}')
    expect(split['hmi_preview_0.cpp']).toBe('#include "hmi_screen_MAIN.hpp"\n// setters')
    expect(split['pou_OTHER.cpp']).toBe('#include "hmi_screen_OTHER.hpp"\nOTHER::OTHER() {}')
    expect(split['hmi_unit_glue.cpp']).toBe(files['hmi_unit_glue.cpp'])
    expect(split['hmi_unit.hpp']).toBe(HEADER)
  })

  it("keeps one screen's header unchanged when another screen gains an element", () => {
    const grown = { ...files, 'hmi_unit.hpp': HEADER.replace('    HMIBUTTON B;', '    HMIBUTTON B;\n    HMILABEL C;') }
    expect(splitScreenHeaders(grown, screens)[screenHeaderName('MAIN')]).toBe(
      splitScreenHeaders(files, screens)[screenHeaderName('MAIN')],
    )
  })

  it('leaves the files whole when a screen class is not found exactly once', () => {
    expect(splitScreenHeaders(files, { ...screens, Missing: [] })).toEqual(files)
    const twice = { ...files, 'hmi_unit.hpp': `${HEADER}\nclass MAIN : public HMISCREEN {\n};\n` }
    expect(splitScreenHeaders(twice, screens)).toEqual(twice)
    expect(splitScreenHeaders({ 'pou_MAIN.cpp': 'x' }, screens)).toEqual({ 'pou_MAIN.cpp': 'x' })
  })
})
