import { registerLanguage } from '../_.register'
import { conf, language } from './python'

console.log('[Python Language] Registering Python language with Monaco')
registerLanguage({
  def: {
    id: 'python',
    extensions: ['.py', '.pyw', '.pyi'],
    aliases: ['Python', 'py', 'python'],
    mimetypes: ['text/x-python', 'application/x-python'],
  },
  conf,
  language,
})
console.log('[Python Language] Python language registered successfully')
