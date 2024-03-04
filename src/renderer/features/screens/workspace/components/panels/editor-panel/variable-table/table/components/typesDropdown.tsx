import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

export default function DropdownTypes() {
  const optionsMock = [
    "BOOL",
    "SINT",
    "INT",
    "DINT",
    "LINT",
    "USINT",
    "UINT",
    "UDINT",
    "ULINT",
    "REAL",
    "LREAL",
    "TIME",
    "DATE",
    "TOD",
    "DT",
    "STRING",
    "BYTE",
    "WORD",
    "DWORD",
    "LWORD",
  ];

  const types = [
    { name: "Base Types", value: optionsMock },
    { name: "User Data Types", value: [] },
    { name: "Native Data Types", value: ["LOGLEVEL"] },
    { name: "Array", value: [] },
  ];

  const [hoveredName, setHoveredName] = useState(null);
  const [selectedType, setSelectedType] = useState(null);

  const handleSelectType = (type) => {
    setSelectedType(type);
    setHoveredName(null);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="w-full h-full items-center justify-center bg-inherit focus:outline-none"
          aria-label="Customise options"
        >
          {selectedType ? selectedType : <p></p>}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] bg-white rounded-sm border border-neutral-300 text-neutral-400 font-medium text-xs"
          align="start"
        >
          {types.map((type) => (
            <DropdownMenu.Sub key={type.name}>
              <DropdownMenu.SubTrigger
                onMouseEnter={() => setHoveredName(type.name)}
                className="focus:outline-none hover:bg-neutral-100 p-1  w-full h-full"
              >
                {type.name}
              </DropdownMenu.SubTrigger>

              {type.value.length > 0 && hoveredName === type.name && (
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={2}
                    alignOffset={-1}
                    className="z-50 min-w-[220px] bg-white border border-neutral-300  text-neutral-400 font-medium text-xs"
                  >
                    {type.value.map((option) => (
                      <DropdownMenu.Item
                        key={option}
                        onClick={() => handleSelectType(option)}
                        className="hover:bg-neutral-100  w-full focus:outline-none p-1"
                      >
                        {option}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              )}
            </DropdownMenu.Sub>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
