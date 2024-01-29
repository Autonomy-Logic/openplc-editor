import { render, screen } from "@testing-library/react";
import { Header, Wrapper } from "./index";
import "@testing-library/jest-dom";

describe("Header", () => {
  it("renders correctly with a title", () => {
    render(<Header title="Test Title" />);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });
});

describe("Wrapper", () => {
  it("renders children correctly", () => {
    render(
      <Wrapper>
        <div>Child Content</div>
      </Wrapper>,
    );
    expect(screen.getByText("Child Content")).toBeInTheDocument();
  });
});
