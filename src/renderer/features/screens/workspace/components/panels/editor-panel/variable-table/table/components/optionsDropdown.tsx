import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import React, { useState } from "react";

export default function OptionsDropdown({ row, value }) {
  const optionsToShow = row[value];

  const [optionSelected, setOptionSelected] = useState(optionsToShow[0].name);

  const filteredOptions = optionsToShow.filter(
    (option) => option.name !== optionSelected,
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="w-full cursor-pointer h-full items-center justify-center bg-inherit focus:outline-none capitalize">
      {optionSelected}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="z-50 hover:scale-105 cursor-pointer transition-all duration-100 w-[var(--radix-popper-anchor-width)] bg-white rounded-sm border border-neutral-300 text-neutral-400 font-medium text-xs"
        align="start"
      >
        {filteredOptions.map((option, index) => (
          <DropdownMenu.Item
            key={index}
            onClick={() => setOptionSelected(option.name)}
            className={` hover:bg-neutral-100 p-1 focus:outline-none capitalize`}
          >
            {option.name}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
