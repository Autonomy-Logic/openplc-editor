type PythonPouData = {
  name: string
  code: string
  type: string
  documentation?: string
}

const injectPythonCode = (pythonPous: PythonPouData[]): string[] => {
  return pythonPous.map((pou) => pou.code)
}

export { injectPythonCode, type PythonPouData }
