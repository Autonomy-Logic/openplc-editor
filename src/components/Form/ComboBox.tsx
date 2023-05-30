import { Combobox } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';
import React, { useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';

import { classNames } from '@/utils';

export type ComboBoxOption = {
  id: number | string;
  label: string;
  value: number | string;
};

export type ComboBoxProps = {
  options: ComboBoxOption[];
  name: string;
  showOptions?: number;
};

const ComboBox: React.FC<ComboBoxProps> = ({ options, name, showOptions = 6 }) => {
  const { control } = useFormContext();
  const [query, setQuery] = useState('');

  const filteredList =
    query === ''
      ? options
      : options.filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Combobox className="w-full" as="div" {...field}>
          <div className="relative w-full">
            <Combobox.Input
              className="flex-1 w-full rounded-md border border-gray-200 shadow-sm px-3 py-2 text-gray-500 focus:outline-none focus:ring-2 focus:ring-open-plc-blue dark:text-gray-400 dark:border-gray-700 dark:bg-white/5"
              onChange={(event) => setQuery(event.target.value)}
              displayValue={(value: ComboBoxOption) => value?.label}
            />
            <Combobox.Button className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus:outline-none">
              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </Combobox.Button>

            {filteredList.length > 0 && (
              <Combobox.Options
                className={`absolute z-10 mt-1 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm dark:bg-gray-800`}
                style={{ maxHeight: `${Math.round(showOptions) * 2.75}rem` }}
              >
                {filteredList.map((option) => (
                  <Combobox.Option
                    key={option.id}
                    value={option}
                    className={({ active }) =>
                      classNames(
                        'relative cursor-default select-none py-2 pl-3 pr-9',
                        active
                          ? 'bg-open-plc-blue text-gray-50'
                          : 'text-gray-500 dark:text-gray-400',
                      )
                    }
                  >
                    {({ active, selected }) => (
                      <>
                        <span
                          className={classNames(
                            'block truncate',
                            selected && 'font-semibold',
                          )}
                        >
                          {option.label}
                        </span>

                        {selected && (
                          <span
                            className={classNames(
                              'absolute inset-y-0 right-0 flex items-center pr-4',
                              active ? 'text-white' : 'text-open-plc-blue',
                            )}
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                      </>
                    )}
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            )}
          </div>
        </Combobox>
      )}
    />
  );
};

export default ComboBox;
