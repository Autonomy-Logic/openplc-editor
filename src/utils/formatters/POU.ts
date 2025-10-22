export const ConvertToLangShortenedFormat = (str: string): 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' => {
  if (str === 'Python') {
    return str.toLowerCase() as 'python'
  }
  if (str === 'C/C++') {
    return 'cpp'
  }
  const draft = str.split(' ')
  const initial = draft
    .map((word) => word.charAt(0))
    .join('')
    .toLowerCase()
  return initial as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
}

export const CreateEditorPath = (name: string, type: 'program' | 'function' | 'function-block') => {
  const path = `/data/pous/${type}/${name}`
  return path
}
