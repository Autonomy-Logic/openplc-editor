import React from "react";

export default function TableHeader({ title }) {
  return (
    <th className="h-8 border-r px-4 py-2 text-center text-neutral-850 font-medium text-xs">
      {title}
    </th>
  );
}