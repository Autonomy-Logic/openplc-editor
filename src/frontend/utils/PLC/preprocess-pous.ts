import type { PLCPou, PLCProjectData } from '../../../middleware/shared/ports/types'
import { addCppLocalVariables } from '../cpp/addCppLocalVariables'
import { generateSTCode as generateCppSTCode } from '../cpp/generateSTCode'
import { validateCppCode } from '../cpp/validateCppCode'
import { addPythonLocalVariables } from '../python/addPythonLocalVariables'
import { generateSTCode } from '../python/generateSTCode'
import { injectPythonCode } from '../python/injectPythonCode'

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
    .filter((pou) => pou.body.language === 'python')
    .map((pou) => ({
      name: pou.name,
      type: pou.pouType,
      code: pou.body.language === 'python' ? (pou.body as { language: string; value: string }).value : '',
      documentation: pou.documentation,
      variables: pou.interface?.variables ?? [],
    }))
}

const applyEarlyCommentWrapping = (projectData: PLCProjectData): PLCProjectData => {
  return {
    ...projectData,
    pous: projectData.pous.map((pou: PLCPou) => {
      if (pou.body.language === 'st' || pou.body.language === 'il') {
        const wrappedValue = wrapUnsupportedComments(pou.body.value as string)
        return {
          ...pou,
          body: {
            language: pou.body.language,
            value: wrappedValue,
          },
        }
      }
      return pou
    }),
  }
}

function preprocessPous(projectData: PLCProjectData, isSimulator: boolean, log: LogFn): PreprocessResult {
  let processedProjectData: PLCProjectData = applyEarlyCommentWrapping(projectData)

  // --- Python processing ---
  const hasPythonCode = projectData.pous.some((pou: PLCPou) => pou.body.language === 'python')

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
          if (processedPythonCodes[pythonIndex]) {
            const stCode = generateSTCode({
              pouName: pou.name,
              allVariables: pou.interface?.variables ?? [],
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
      const code = pou.body.language === 'cpp' ? (pou.body as { language: string; value: string }).value : ''
      const validation = validateCppCode(code)
      if (!validation.valid) {
        log('error', `Validation failed for "${pou.name}": ${validation.error}`)
        validationFailed = true
      }
    }

    if (validationFailed) {
      return { projectData: processedProjectData as ProjectDataWithCpp, validationFailed: true }
    }

    processedProjectData = addCppLocalVariables(processedProjectData)

    const originalCppPousData = cppPous.map((pou) => ({
      name: pou.name,
      code: pou.body.language === 'cpp' ? (pou.body as { language: string; value: string }).value : '',
      variables: pou.interface?.variables ?? [],
    }))

    processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
      if (pou.body.language === 'cpp') {
        const stCode = generateCppSTCode({
          pouName: pou.name,
          allVariables: pou.interface?.variables ?? [],
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

  return { projectData: processedProjectData as ProjectDataWithCpp, validationFailed: false }
}

export { preprocessPous, type ProjectDataWithCpp }
