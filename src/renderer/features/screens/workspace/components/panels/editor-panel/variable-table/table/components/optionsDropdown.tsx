import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import React, { useState } from "react";

export default function OptionsDropdown({ row, value }) {
  const optionsToShow = row[value];

  const [optionSelected, setOptionSelected] = useState(optionsToShow[0].name);
  const selectDefaultStyle =
    "w-full bg-inherit focus:outline-none text-center ";
  const optionDefaultStyle =
    "w-full bg-inherit focus:outline-none text-center ";

  const filteredOptions = optionsToShow.filter(
    (option) => option.name !== optionSelected,
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={selectDefaultStyle} aria-label="Select option">
          {optionSelected}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="z-50 min-w-[180px] bg-white rounded-sm border border-neutral-300 "
        align="start"
        sideOffset={7}
      >
        {filteredOptions.map((option, index) => (
          <DropdownMenu.Item
            key={index}
            onClick={() => setOptionSelected(option.name)}
            className={`${optionDefaultStyle} hover:bg-neutral-100 p-2`}
          >
            {option.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
