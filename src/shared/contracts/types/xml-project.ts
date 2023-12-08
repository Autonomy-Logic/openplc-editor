import z from 'zod';

import { ProjectSchema } from '../validations';

export type TXmlProject = z.infer<typeof ProjectSchema>;
