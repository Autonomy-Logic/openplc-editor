export const ConvertToLangShortenedFormat = (str: string): 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' => {
  if (str === 'Python') {
    return str.toLowerCase() as 'python'
  }
  const draft = str.split(' ')
  const initial = draft
    .map((word) => word.charAt(0))
    .join('')
    .toLowerCase()
  return initial as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python'
}

export const CreateEditorPath = (name: string, type: 'program' | 'function' | 'function-block') => {
  const path = `/data/pous/${type}/${name}`
  return path
}
