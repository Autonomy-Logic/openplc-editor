import { PLCPou, PLCProjectData } from '@root/types/PLC/open-plc'
import { addCppLocalVariables } from '@root/utils/cpp/addCppLocalVariables'
import { generateSTCode as generateCppSTCode } from '@root/utils/cpp/generateSTCode'
import { validateCppCode } from '@root/utils/cpp/validateCppCode'
import { addPythonLocalVariables } from '@root/utils/python/addPythonLocalVariables'
import { generateSTCode } from '@root/utils/python/generateSTCode'
import { injectPythonCode } from '@root/utils/python/injectPythonCode'

import { wrapUnsupportedComments } from './wrap-unsupported-comments'

type CppPouData = {
  name: string
  code: string
  variables: unknown[]
}

type ProjectDataWithCpp = PLCProjectData & {
  originalCppPous?: CppPouData[]
}

type LogFn = (level: 'info' | 'error', message: string) => void

type PreprocessResult = {
  projectData: ProjectDataWithCpp
  validationFailed: boolean
}

const extractPythonData = (pous: PLCPou[]) => {
  return pous
    .filter((pou) => pou.data.body.language === 'python')
    .map((pou) => ({
      name: pou.data.name,
      type: pou.type,
      code: pou.data.body.language === 'python' ? (pou.data.body as { value: string }).value : '',
      documentation: pou.data.documentation,
      variables: pou.data.variables,
    }))
}

const applyEarlyCommentWrapping = (projectData: PLCProjectData): PLCProjectData => {
  return {
    ...projectData,
    pous: projectData.pous.map((pou: PLCPou) => {
      if (pou.data.body.language === 'st' || pou.data.body.language === 'il') {
        const wrappedValue = wrapUnsupportedComments(pou.data.body.value)
        return {
          ...pou,
          data: {
            ...pou.data,
            body: {
              language: pou.data.body.language,
              value: wrappedValue,
            },
          },
        } as PLCPou
      }
      return pou
    }),
  }
}

function preprocessPous(projectData: PLCProjectData, isSimulator: boolean, log: LogFn): PreprocessResult {
  let processedProjectData: PLCProjectData = applyEarlyCommentWrapping(projectData)

  // --- Python processing ---
  const hasPythonCode = projectData.pous.some((pou: PLCPou) => pou.data.body.language === 'python')

  if (hasPythonCode) {
    const pythonPous = projectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'python')

    pythonPous.forEach((pou) => {
      log('info', `Found Python POU: "${pou.data.name}" (${pou.type})`)
    })

    log('info', `Processing ${pythonPous.length} Python POU(s)...`)

    processedProjectData = addPythonLocalVariables(projectData)

    if (isSimulator) {
      // Simulator: keep runtime variables but replace body with a no-op ST statement
      processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
        if (pou.data.body.language === 'python') {
          pou.data.body = {
            language: 'st',
            value: 'first_run := 0;',
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
        if (pou.data.body.language === 'python') {
          if (processedPythonCodes[pythonIndex]) {
            const stCode = generateSTCode({
              pouName: pou.data.name,
              allVariables: pou.data.variables,
              processedPythonCode: processedPythonCodes[pythonIndex],
            })

            pou.data.body = {
              language: 'st',
              value: stCode,
            }

            pythonIndex++
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
  const hasCppCode = processedProjectData.pous.some((pou: PLCPou) => pou.data.body.language === 'cpp')

  if (hasCppCode) {
    const cppPous = processedProjectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'cpp')

    cppPous.forEach((pou) => {
      log('info', `Found C/C++ POU: "${pou.data.name}" (${pou.type})`)
    })

    log('info', `Processing ${cppPous.length} C/C++ POU(s)...`)

    let validationFailed = false
    for (const pou of cppPous) {
      const code = pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : ''
      const validation = validateCppCode(code)
      if (!validation.valid) {
        log('error', `Validation failed for "${pou.data.name}": ${validation.error}`)
        validationFailed = true
      }
    }

    if (validationFailed) {
      return { projectData: processedProjectData as ProjectDataWithCpp, validationFailed: true }
    }

    processedProjectData = addCppLocalVariables(processedProjectData)

    const originalCppPousData = cppPous.map((pou) => ({
      name: pou.data.name,
      code: pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : '',
      variables: pou.data.variables,
    }))

    processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
      if (pou.data.body.language === 'cpp') {
        const stCode = generateCppSTCode({
          pouName: pou.data.name,
          allVariables: pou.data.variables,
        })

        pou.data.body = {
          language: 'st',
          value: stCode,
        }
      }
      return pou
    })

    const projectDataWithCpp = processedProjectData as ProjectDataWithCpp
    projectDataWithCpp.originalCppPous = originalCppPousData

    log('info', `Successfully processed ${cppPous.length} C/C++ POU(s)`)
  }

  return { projectData: processedProjectData as ProjectDataWithCpp, validationFailed: false }
}

export { preprocessPous, type ProjectDataWithCpp }
