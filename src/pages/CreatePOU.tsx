import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Form } from '@/components';
import { useTitlebar } from '@/hooks';

const createPOUSchema = z.object({
  name: z
    .string()
    .nonempty({
      message: 'O nome é obrigatório',
    })
    .transform((name) => {
      return name
        .trim()
        .split(' ')
        .map((word) => word[0].toLocaleUpperCase().concat(word.substring(1)))
        .join(' ');
    }),
  combobox: z.object({
    id: z.union([z.number(), z.string()]),
    label: z.string(),
    value: z.union([z.number(), z.string()]),
  }),
});

type CreatePOUData = z.infer<typeof createPOUSchema>;

const CreateNewPOU: React.FC = () => {
  const { dispose } = useTitlebar();

  useEffect(() => {
    dispose();
  }, [dispose]);

  const createPouForm = useForm<CreatePOUData>({
    resolver: zodResolver(createPOUSchema),
  });

  async function createUser(data: CreatePOUData) {
    console.log(data);
  }

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = createPouForm;

  return (
    <div className="h-screen flex flex-row gap-6 items-center justify-center">
      <FormProvider {...createPouForm}>
        <form
          onSubmit={handleSubmit(createUser)}
          className="flex flex-col gap-4 w-full max-w-xs"
        >
          <Form.Field>
            <Form.Label htmlFor="name">Pou Name</Form.Label>
            <Form.Input type="name" name="name" />
            <Form.ErrorMessage field="name" />
          </Form.Field>

          <Form.Field>
            <Form.Label htmlFor="combobox">Pou Name</Form.Label>
            <Form.ComboBox
              name="combobox"
              options={[
                { id: 0, label: 'open plc editor', value: 0 },
                { id: 1, label: 'lorem ipsum', value: 1 },
              ]}
            />
            <Form.ErrorMessage field="combobox" />
          </Form.Field>

          {/* <button
            type="submit"
            disabled={isSubmitting}
            className="bg-violet-500 text-white rounded px-3 h-10 font-semibold text-sm hover:bg-violet-600"
          >
            Salvar
          </button> */}
        </form>
      </FormProvider>
    </div>
  );
};

export default CreateNewPOU;
