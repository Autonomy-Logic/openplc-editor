import { z } from 'zod'
import { PouSchema } from '../../../shared/contracts/validations'
import { formatDate } from '../../../utils'

const PLCProjectConfigSchema = z.object({
	/**
	 * Here should be put all information about the project
	 */
	configs: z.object({
		'@xmlns': z.string().default('http://www.plcopen.org/xml/tc6_0201'),
		'@xmlns:ns1': z.string().default('http://www.plcopen.org/xml/tc6.xsd'),
		'@xmlns:xhtml': z.string().default('http://www.w3.org/1999/xhtml'),
		'@xmlns:xsi': z.string().default('http://www.w3.org/2001/XMLSchema'),
		'@xsi:schemaLocation': z
			.string()
			.default(
				'http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200'
			),
		fileHeader: z.object({
			'@companyName': z.string().default('Unknown'),
			'@creationDateTime': z.string().default(formatDate(new Date())),
			'@productName': z.string().default('Unnamed'),
			'@productVersion': z.string().default('1'),
		}),
		contentHeader: z.object({
			'@name': z.string().default('Unnamed'),
			coordinateInfo: z.object({
				fbd: z.object({
					scaling: z.object({
						'@x': z.string().default('10'),
						'@y': z.string().default('10'),
					}),
				}),
				ld: z.object({
					scaling: z.object({
						'@x': z.string().default('10'),
						'@y': z.string().default('10'),
					}),
				}),
				sfc: z.object({
					scaling: z.object({
						'@x': z.string().default('10'),
						'@y': z.string().default('10'),
					}),
				}),
			}),
		}),
		instances: z.object({
			configurations: z.object({
				configuration: z.object({
					'@name': z.string().default('Config0'),
					resource: z.object({
						'@name': z.string().default('Res0'),
					}),
				}),
			}),
		}),
	}),
	/**
	 * Here goes all data that can be manipulated
	 */
	data: z.object({
		types: z.object({
			dataTypes: z.object({}),
			pous: z
				.object({
					pou: z.array(z.lazy(() => PouSchema)),
				})
				.partial(),
		}),
	}),
})
