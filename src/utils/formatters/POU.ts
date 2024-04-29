export const ConvertToLangShortenedFormat = (str: string): 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL' => {
  const draft = str.split(' ')
  const initial = draft.map((word) => word.charAt(0).toUpperCase()).join('')
  return initial as 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL'
}

export const CreateEditorPath = (
  name: string,
  type: 'program' | 'function' | 'function-block',
) => {
  const path = `/data/pous/${type}/${name}`
  return path
}
