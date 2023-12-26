import { z } from 'zod';

import { StoreSchema } from '../../validations';

export type TStoreType = z.infer<typeof StoreSchema>;
