// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable react/function-component-definition */
// Review this eslint rule
/* eslint-disable react/require-default-props */
import { Combobox } from '@headlessui/react';
import { FC, useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { HiCheck, HiChevronUpDown } from 'react-icons/hi2';

import { classNames } from '../../../utils';
/**
 * Represents an option for the ComboBox component.
 */
export type ComboBoxOption = {
  id: number | string;
  label: string;
  value: number | string;
  className?: string;
};
/**
 * Props for the ComboBox component.
 */
export type ComboBoxProps = {
  options: ComboBoxOption[];
  name: string;
  showOptions?: number;
  optionsClassName?: string;
};
/**
 * ComboBox component that provides a searchable and selectable combobox input.
 * @param options - An array of ComboBoxOption objects representing selectable options.
 * @param name - The name for the ComboBox input element, used for form control.
 * @param showOptions - The maximum number of options to show in the dropdown.
 */
const ComboBox: FC<ComboBoxProps> = ({ options, name, showOptions = 6 }) => {
  const { control } = useFormContext();
  const [query, setQuery] = useState('');
  const filteredList =
    query === ''
      ? options
      : options.filter(({ label }) =>
          label.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Combobox className="w-full" as="div" {...field}>
          <div className="relative w-full">
            <Combobox.Input
              className="w-full flex-1 rounded-md border border-gray-900/10 px-3 py-2
               text-gray-500 shadow-sm focus:outline-none focus:ring-2
               focus:ring-open-plc-blue dark:border-white/5 dark:bg-white/5 dark:text-gray-400"
              onChange={(event) => setQuery(event.target.value)}
              displayValue={(value: ComboBoxOption) => value?.label}
            />
            <Combobox.Button className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus:outline-none">
              <HiChevronUpDown
                className="h-5 w-5 text-gray-400"
                aria-hidden="true"
              />
            </Combobox.Button>
            {filteredList.length > 0 && (
              <Combobox.Select
                className="absolute z-10 mt-1 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-gray-800 sm:text-sm"
                style={{ maxHeight: `${Math.round(showOptions) * 2.75}rem` }}
              >
                {filteredList.map(({ id, label, value, className }) => (
                  <Combobox.Option
                    key={id}
                    value={{ id, label, value }}
                    className={({ active }) =>
                      classNames(
                        'relative cursor-default select-none py-2 pl-3 pr-9 transition-colors duration-300',
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
                            !!className && className,
                          )}
                        >
                          {label}
                        </span>
                        {selected && (
                          <span
                            className={classNames(
                              'absolute inset-y-0 right-0 flex items-center pr-4',
                              active ? 'text-white' : 'text-open-plc-blue',
                            )}
                          >
                            <HiCheck className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                      </>
                    )}
                  </Combobox.Option>
                ))}
              </Combobox.Select>
            )}
          </div>
        </Combobox>
      )}
    />
  );
};

export default ComboBox;
