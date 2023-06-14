import { zodResolver } from '@hookform/resolvers/zod';
import { CONSTANTS } from '@shared/constants';
import React, { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Form } from '@/components';
import { useIpcRender, useTitlebar } from '@/hooks';

const {
  languages,
  types,
  channels: { set },
} = CONSTANTS;

const CreateNewPOU: React.FC = () => {
  const { dispose } = useTitlebar();
  const { t: translate } = useTranslation();
  const { t } = useTranslation('createPOU');
  const { invoke } = useIpcRender<{ name: string; type: string; language: string }>();

  const createPOUSchema = z.object({
    name: z.string().nonempty({
      message: t('errors.name'),
    }),
    type: z.object(
      {
        id: z.union([z.number(), z.string()]),
        label: z.string(),
        value: z.union([z.number(), z.string()]),
      },
      { required_error: t('errors.type') },
    ),
    language: z.object(
      {
        id: z.union([z.number(), z.string()]),
        label: z.string(),
        value: z.union([z.number(), z.string()]),
      },
      { required_error: t('errors.language') },
    ),
  });

  type createPOUSchemaData = z.infer<typeof createPOUSchema>;

  const typeOptions = [{ id: 0, label: types.PROGRAM, value: types.PROGRAM }];

  const languageOptions = [{ id: 0, label: languages.LD, value: languages.LD }];

  useEffect(() => {
    dispose();
  }, [dispose]);

  const handleCancel = () => window.close();

  const createPouForm = useForm<createPOUSchemaData>({
    resolver: zodResolver(createPOUSchema),
    defaultValues: {
      name: 'program0',
      type: typeOptions[0],
    },
  });

  const handleCreatePOU = async (data: createPOUSchemaData) => {
    const {
      type: { value: type },
      language: { value: language },
      name,
    } = data;
    invoke(set.CREATE_POU_DATA, {
      name,
      type: type as keyof typeof types,
      language: language as keyof typeof languages,
    });
    window.close();
  };

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = createPouForm;

  return (
    <div className="h-screen w-screen p-8">
      <FormProvider {...createPouForm}>
        <form
          onSubmit={handleSubmit(handleCreatePOU)}
          className="grid grid-cols-2 grid-rows-3 gap-x-4 w-full"
        >
          <Form.Field className="col-span-full">
            <Form.Label htmlFor="name"> {t('labels.name')}</Form.Label>
            <Form.Input type="name" name="name" />
            <Form.ErrorMessage field="name" />
          </Form.Field>
          <Form.Field>
            <Form.Label htmlFor="type"> {t('labels.type')}</Form.Label>
            <Form.ComboBox name="type" options={typeOptions} />
            <Form.ErrorMessage field="type" />
          </Form.Field>
          <Form.Field>
            <Form.Label htmlFor="language"> {t('labels.language')}</Form.Label>
            <Form.ComboBox name="language" options={languageOptions} showOptions={2} />
            <Form.ErrorMessage field="language" />
          </Form.Field>
          <Form.Field className="flex flex-row h-10 mt-8 gap-4 col-start-2">
            <Button label={translate('buttons.ok')} disabled={isSubmitting} widthFull />
            <Button
              type="button"
              appearance="secondary"
              label={translate('buttons.cancel')}
              disabled={isSubmitting}
              onClick={handleCancel}
              widthFull
            />
          </Form.Field>
        </form>
      </FormProvider>
    </div>
  );
};

export default CreateNewPOU;
