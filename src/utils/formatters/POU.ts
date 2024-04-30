export const ConvertToLangShortenedFormat = (str: string): 'il' | 'st' | 'ld' | 'sfc' | 'fbd' => {
  const draft = str.split(' ')
  const initial = draft.map((word) => word.charAt(0)).join('')
  return initial as 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

export const CreateEditorPath = (name: string, type: 'program' | 'function' | 'function-block') => {
  const path = `/data/pous/${type}/${name}`
  return path
}
