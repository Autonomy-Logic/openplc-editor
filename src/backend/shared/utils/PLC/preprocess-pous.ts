import { addCppLocalVariables } from '../../../../frontend/utils/cpp/addCppLocalVariables'
import { generateSTCode as generateCppSTCode } from '../../../../frontend/utils/cpp/generateSTCode'
import { validateCppCode } from '../../../../frontend/utils/cpp/validateCppCode'
import { addPythonLocalVariables } from '../../../../frontend/utils/python/addPythonLocalVariables'
import { generateSTCode } from '../../../../frontend/utils/python/generateSTCode'
import { injectPythonCode } from '../../../../frontend/utils/python/injectPythonCode'
import { pythonInterfaceVariables, pythonRefusedVariables } from '../../../../frontend/utils/python/block-interface'
import { describeShmField, describeVariableType } from '../../../../frontend/utils/python/shm-type-map'
import type { PLCPou, PLCProjectData, PLCVariable } from '../../../../middleware/shared/ports/types'
import { generateSoftMotionArtifacts } from '../../ethercat/generate-softmotion'

type CppPouData = {
  name: string
  code: string
  variables: PLCVariable[]
}

type ProjectDataWithCpp = PLCProjectData & {
  originalCppPous?: CppPouData[]
}

type LogFn = (level: 'info' | 'error', message: string) => void

type PreprocessResult = {
  projectData: ProjectDataWithCpp
  validationFailed: boolean
  /**
   * Human-facing reason for `validationFailed`, when one is known.
   *
   * Callers used to hard-code the C/C++ setup()/loop() message, which was the
   * only way validation could fail. Python-on-an-unsupported-target is a second
   * way, and reporting it as a C/C++ problem would send the user looking in the
   * wrong file. Absent → the caller's default message still applies.
   */
  validationError?: string
}

/**
 * Whether the selected target can host Python function blocks, and what to call
 * it when it cannot.
 *
 * Mirrors `TargetCapabilities.pythonFunctionBlocks`, which already states the
 * contract: Runtime v3 / v4 run them natively, the Simulator compiles them as
 * no-op stubs, and arduino-cli targets reject them at build time. The rejection
 * half was never implemented — a Python block on an Arduino target took the
 * full Linux pipeline and died inside avr-g++ with `'python_block_loader' was
 * not declared in this scope`, which tells the user nothing.
 *
 * Optional so the library build paths, which have no board in hand, keep their
 * existing behaviour.
 */
type PythonTargetSupport = {
  supported: boolean
  /** Board name as the user selected it, for the error message. */
  targetLabel: string
}

const extractPythonData = (pous: PLCPou[]) => {
  return pous
    .filter((pou) => pou.body.language === 'python')
    .map((pou) => ({
      name: pou.name,
      type: pou.pouType,
      code:
        /* istanbul ignore next -- defensive: filter above guarantees language === 'python' */
        pou.body.language === 'python' ? (pou.body as { language: string; value: string }).value : '',
      documentation: pou.documentation,
      variables:
        /* istanbul ignore next -- defensive: interface may be undefined */
        pou.interface?.variables ?? [],
    }))
}

function preprocessPous(
  projectData: PLCProjectData,
  isSimulator: boolean,
  log: LogFn,
  pythonSupport?: PythonTargetSupport,
): PreprocessResult {
  let processedProjectData: PLCProjectData = projectData

  // --- Python processing ---
  const hasPythonCode = projectData.pous.some((pou: PLCPou) => pou.body.language === 'python')

  if (hasPythonCode && pythonSupport && !pythonSupport.supported) {
    // Reject before any Python processing runs. Generating the shared-memory
    // stub for a target that cannot load it only moves the failure into the
    // board's C++ toolchain, where the message is about `python_block_loader`
    // rather than about Python blocks being unsupported here.
    const names = projectData.pous
      .filter((pou: PLCPou) => pou.body.language === 'python')
      .map((pou: PLCPou) => `"${pou.name}"`)
      .join(', ')
    const message =
      `Python function blocks are not supported on ${pythonSupport.targetLabel} — ` +
      `they require the OpenPLC Linux runtime. Remove or change ${names}, or select a Runtime target.`
    log('error', message)
    return {
      projectData: processedProjectData as ProjectDataWithCpp,
      validationFailed: true,
      validationError: message,
    }
  }

  // A Python POU's interface can only carry types both sides of the shared
  // memory boundary describe identically. Anything else is refused here rather
  // than skipped during encoding: a field the Python format string omits does
  // not go missing, it shifts every later field's offset, so the failure lands
  // on unrelated variables and looks like corrupted data instead of an
  // unsupported type. Structures, enumerations and function block instances
  // arrive in later phases.
  if (hasPythonCode) {
    // A class this side of the boundary cannot express is refused first, and on
    // its own terms: telling a user their VAR_TEMP is an unsupported *type*
    // would send them to change the type, which is not the problem.
    const refusedClasses: string[] = []
    for (const pou of projectData.pous) {
      if (pou.body.language !== 'python') continue
      for (const { variable, reason } of pythonRefusedVariables(pou.interface?.variables ?? [])) {
        refusedClasses.push(`"${pou.name}.${variable.name}": ${reason}`)
      }
    }
    if (refusedClasses.length > 0) {
      const message = refusedClasses.join(' ')
      log('error', message)
      return {
        projectData: processedProjectData as ProjectDataWithCpp,
        validationFailed: true,
        validationError: message,
      }
    }

    const unsupported: string[] = []
    for (const pou of projectData.pous) {
      if (pou.body.language !== 'python') continue
      for (const variable of pythonInterfaceVariables(pou.interface?.variables ?? [])) {
        if (describeShmField(variable) === null) {
          unsupported.push(`"${pou.name}.${variable.name}" (${describeVariableType(variable)})`)
        }
      }
    }
    if (unsupported.length > 0) {
      const message =
        `Python function blocks cannot exchange these variable types yet: ${unsupported.join(', ')}. ` +
        'Supported types are BOOL, the integer and bit-string types, REAL/LREAL, TIME/DATE/TOD/DT, ' +
        'STRING, WSTRING, and arrays of those.'
      log('error', message)
      return {
        projectData: processedProjectData as ProjectDataWithCpp,
        validationFailed: true,
        validationError: message,
      }
    }
  }

  if (hasPythonCode) {
    const pythonPous = projectData.pous.filter((pou: PLCPou) => pou.body.language === 'python')

    pythonPous.forEach((pou) => {
      log('info', `Found Python POU: "${pou.name}" (${pou.pouType})`)
    })

    log('info', `Processing ${pythonPous.length} Python POU(s)...`)

    processedProjectData = addPythonLocalVariables(projectData)

    if (isSimulator) {
      // Simulator: keep runtime variables but replace body with a no-op ST statement
      processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
        if (pou.body.language === 'python') {
          return {
            ...pou,
            body: {
              language: 'st' as const,
              value: 'first_run := 0;',
            },
          }
        }
        return pou
      })
    } else {
      // Full pipeline for runtime targets
      const pythonData = extractPythonData(processedProjectData.pous)
      const processedPythonCodes = injectPythonCode(pythonData)

      let pythonIndex = 0
      processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
        if (pou.body.language === 'python') {
          /* istanbul ignore next -- defensive: processedPythonCodes always matches python POU count */
          if (processedPythonCodes[pythonIndex]) {
            const stCode = generateSTCode({
              pouName: pou.name,
              allVariables:
                /* istanbul ignore next -- defensive: interface may be undefined */
                pou.interface?.variables ?? [],
              processedPythonCode: processedPythonCodes[pythonIndex],
            })

            pythonIndex++
            return {
              ...pou,
              body: {
                language: 'st' as const,
                value: stCode,
              },
            }
          }
        }
        return pou
      })

      log('info', `Successfully processed ${processedPythonCodes.length} Python POU(s)`)
    }

    if (isSimulator) {
      log('info', `Compiled ${pythonPous.length} Python POU(s) as empty stubs for simulator`)
    }
  }

  // --- C++ processing ---
  const hasCppCode = processedProjectData.pous.some((pou: PLCPou) => pou.body.language === 'cpp')

  if (hasCppCode) {
    const cppPous = processedProjectData.pous.filter((pou: PLCPou) => pou.body.language === 'cpp')

    cppPous.forEach((pou) => {
      log('info', `Found C/C++ POU: "${pou.name}" (${pou.pouType})`)
    })

    log('info', `Processing ${cppPous.length} C/C++ POU(s)...`)

    let validationFailed = false
    for (const pou of cppPous) {
      /* istanbul ignore next -- defensive: cppPous filter guarantees language === 'cpp' */
      const code = pou.body.language === 'cpp' ? (pou.body as { language: string; value: string }).value : ''
      const validation = validateCppCode(code)
      if (!validation.valid) {
        log('error', `Validation failed for "${pou.name}": ${validation.error}`)
        validationFailed = true
      }
    }

    if (validationFailed) {
      return {
        projectData: processedProjectData as ProjectDataWithCpp,
        validationFailed: true,
        validationError: 'POU validation failed. Check C/C++ code for missing setup()/loop() functions.',
      }
    }

    processedProjectData = addCppLocalVariables(processedProjectData)

    const originalCppPousData = cppPous.map((pou) => ({
      name: pou.name,
      code:
        /* istanbul ignore next -- defensive: cppPous filter guarantees language === 'cpp' */
        pou.body.language === 'cpp' ? (pou.body as { language: string; value: string }).value : '',
      variables:
        /* istanbul ignore next -- defensive: interface may be undefined */
        pou.interface?.variables ?? [],
    }))

    processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
      if (pou.body.language === 'cpp') {
        const stCode = generateCppSTCode({
          pouName: pou.name,
          allVariables:
            /* istanbul ignore next -- defensive: interface may be undefined */
            pou.interface?.variables ?? [],
        })

        return {
          ...pou,
          body: {
            language: 'st' as const,
            value: stCode,
          },
        }
      }
      return pou
    })

    const projectDataWithCpp = processedProjectData as ProjectDataWithCpp
    projectDataWithCpp.originalCppPous = originalCppPousData

    log('info', `Successfully processed ${cppPous.length} C/C++ POU(s)`)
  }

  // --- SoftMotion: generate AXIS_REF_SM3 globals + PDO scalars + drive bridge
  //     for CiA 402 EtherCAT axes (no-op when the project has none). ---
  const withMotion = generateSoftMotionArtifacts(processedProjectData) as ProjectDataWithCpp
  if (withMotion !== processedProjectData) {
    processedProjectData = withMotion
    log('info', 'Generated SoftMotion axis bindings for CiA 402 drive(s)')
  }

  return { projectData: processedProjectData as ProjectDataWithCpp, validationFailed: false }
}

export { preprocessPous, type ProjectDataWithCpp, type PythonTargetSupport }
