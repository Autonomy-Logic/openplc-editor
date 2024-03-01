import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ExitIcon } from "~/renderer/assets";

export default function ModalTypes() {
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

  const modalDefaultStyle =
    "rounded absolute z-50 bg-white border border-neutral-300 shadow-xl p-[4px]";

  const handleSelectType = (type) => {
    setSelectedType(type);
    setHoveredName(null);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="w-full h-full" aria-label="Update dimensions">
          {selectedType}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`${modalDefaultStyle} left-[82px] -top-8 w-[200px] rounded-xl`}
        >
          {types.map((type, index) => (
            <div
              key={index}
              onMouseEnter={() => setHoveredName(type.name)}
              onMouseLeave={() => setHoveredName(null)}
              onClick={(e) => e.preventDefault()}
            >
              <h1 className="p-[4px] rounded-md hover:bg-neutral-200 ">
                {type.name}
              </h1>
              {hoveredName === type.name && type.value.length > 0 && (
                <Popover.Content
                  className={`${modalDefaultStyle} left-[275px] -top-8 z-50 w-[120px]`}
                >
                  {type.value.map((option, index) => {
                    return (
                      <p
                        type="button"
                        onClick={() => handleSelectType(option)}
                        className="p-[4px] rounded-md hover:bg-neutral-200"
                        key={index}
                      >
                        {option}
                      </p>
                    );
                  })}
                </Popover.Content>
              )}
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
