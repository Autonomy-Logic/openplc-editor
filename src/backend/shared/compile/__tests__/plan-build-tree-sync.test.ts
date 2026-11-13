import {
  ARDUINO_EXPORT_DIR,
  planBuildTreeSync,
  shouldWipeBuildFolder,
  staticCandidates,
} from '../steps/plan-build-tree-sync'

const STATIC = {
  'examples/Baremetal/Baremetal.ino': 'void setup() {}\n',
  'examples/Baremetal/hal_conf_extra.h': '#define HAL_X 1\n',
  'src/iec_types.hpp': '// runtime header\n',
  'src/defines.h': '// stub\n',
  'src/arduino.cpp': '// placeholder HAL\n',
}

describe('staticCandidates', () => {
  it('returns only paths whose desired content is the static resource', () => {
    const desired = {
      ...STATIC,
      'src/defines.h': '#define BOARD_X\n',
      'src/pou_MAIN.cpp': 'int main_pou;\n',
    }
    expect(staticCandidates(desired, STATIC).sort()).toEqual([
      'examples/Baremetal/Baremetal.ino',
      'examples/Baremetal/hal_conf_extra.h',
      'src/iec_types.hpp',
    ])
  })

  it('never treats the board HAL as static, even when it matches a resource', () => {
    expect(staticCandidates({ 'src/arduino.cpp': STATIC['src/arduino.cpp'] }, STATIC)).toEqual([])
  })
})

describe('planBuildTreeSync', () => {
  const desired = {
    ...STATIC,
    'src/defines.h': '#define BOARD_X\n',
    'src/arduino.cpp': '// board HAL\n',
    'src/pou_MAIN.cpp': 'int main_pou;\n',
  }

  it('writes everything into an empty folder', () => {
    const plan = planBuildTreeSync({ desired, staticFiles: STATIC, existingPaths: [], existingContents: {} })
    expect(plan.write).toEqual(Object.keys(desired).sort())
    expect(plan.remove).toEqual([])
  })

  it('skips static files whose copy on disk is unchanged and rewrites every generated file', () => {
    const plan = planBuildTreeSync({
      desired,
      staticFiles: STATIC,
      existingPaths: Object.keys(desired),
      existingContents: {
        'examples/Baremetal/Baremetal.ino': STATIC['examples/Baremetal/Baremetal.ino'],
        'examples/Baremetal/hal_conf_extra.h': STATIC['examples/Baremetal/hal_conf_extra.h'],
        'src/iec_types.hpp': STATIC['src/iec_types.hpp'],
      },
    })
    expect(plan.write).toEqual(['src/arduino.cpp', 'src/defines.h', 'src/pou_MAIN.cpp'])
    expect(plan.remove).toEqual([])
  })

  it('rewrites a static file whose copy on disk differs or could not be read', () => {
    const plan = planBuildTreeSync({
      desired,
      staticFiles: STATIC,
      existingPaths: Object.keys(desired),
      existingContents: {
        'examples/Baremetal/Baremetal.ino': 'void setup() { old(); }\n',
        'src/iec_types.hpp': STATIC['src/iec_types.hpp'],
      },
    })
    expect(plan.write).toContain('examples/Baremetal/Baremetal.ino')
    expect(plan.write).toContain('examples/Baremetal/hal_conf_extra.h')
    expect(plan.write).not.toContain('src/iec_types.hpp')
  })

  it('removes files the build no longer produces, such as a deleted POU', () => {
    const plan = planBuildTreeSync({
      desired,
      staticFiles: STATIC,
      existingPaths: [...Object.keys(desired), 'src/pou_DELETED.cpp', 'src/c_blocks_code.cpp'],
      existingContents: {},
    })
    expect(plan.remove).toEqual(['src/c_blocks_code.cpp', 'src/pou_DELETED.cpp'])
  })

  it("never removes arduino-cli's export folder", () => {
    const exported = `${ARDUINO_EXPORT_DIR}arduino.avr.mega/Baremetal.ino.hex`
    const plan = planBuildTreeSync({ desired, staticFiles: STATIC, existingPaths: [exported], existingContents: {} })
    expect(plan.remove).toEqual([])
  })
})

describe('shouldWipeBuildFolder', () => {
  it('keeps the folder for a normal arduino-cli build', () => {
    expect(shouldWipeBuildFolder({ cleanBuild: false, isRuntimeV3: false, isRuntimeV4: false })).toBe(false)
  })

  it('wipes it for a clean build', () => {
    expect(shouldWipeBuildFolder({ cleanBuild: true, isRuntimeV3: false, isRuntimeV4: false })).toBe(true)
  })

  it('wipes it for Runtime v3 and v4, which archive the folder for upload', () => {
    expect(shouldWipeBuildFolder({ cleanBuild: false, isRuntimeV3: true, isRuntimeV4: false })).toBe(true)
    expect(shouldWipeBuildFolder({ cleanBuild: false, isRuntimeV3: false, isRuntimeV4: true })).toBe(true)
  })
})
