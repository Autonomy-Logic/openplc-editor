import { registerLanguage } from '../_.register'
import { conf, language } from './il'

registerLanguage({
	def: {
		id: 'il',
		extensions: ['.il'],
		aliases: ['il'],
		mimetypes: ['text/instruction-list'],
	},
	conf,
	language,
})
