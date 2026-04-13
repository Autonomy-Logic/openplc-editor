import { registerLanguage } from '../_.register'
import { conf, language } from './st'

registerLanguage({
  def: {
    id: 'st',
    extensions: ['.st'],
    aliases: ['Structured Text', 'st'],
    mimetypes: ['text/structured-text'],
  },
  conf,
  language,
})
