import { z } from "zod";

const dataTypeSchema = z.object({
    dataType: z.array(z.object({
        '@name':z.string(),
        baseType:z.object({
            type: z.enum(['BOOL', 'INT', 'DINT']),
        }),
        initialValue: z.object({
            simpleValue: z.object({
                '@value': z.string(),
            }),
        }),
    }))
})