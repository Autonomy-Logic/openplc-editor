import React from "react";
import { render } from "@testing-library/react";
import Container from "./index";
import "@testing-library/jest-dom";

describe("Container component", () => {
  it("renders with provided props", () => {
    const { container } = render(<Container data-testid="test-container" />);
    const mainElement = container.querySelector("main");

    expect(mainElement).toBeInTheDocument();

    expect(mainElement).toHaveClass(
      "w-full h-screen flex py-4 justify-evenly px-16",
    );
  });
});
