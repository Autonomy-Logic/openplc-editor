import { registerLanguage } from '../_.register'
import { conf, language } from './python'

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
