import { writeFile } from 'fs'
import { join } from 'path'

type ICreateXMLFileProps = {
	path: string
	data: string
	fileName: string
}

const CreateXMLFile = async (args: ICreateXMLFileProps) => {
	const { path, fileName, data } = args
	const normalizedPath = join(path, `${fileName}.xml`)
	writeFile(normalizedPath, data, (error) => {
		if (error) throw error
	})
	return { ok: true }
}

export { CreateXMLFile }
