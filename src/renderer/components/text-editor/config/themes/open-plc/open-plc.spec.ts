import { lightThemeData, darkThemeData } from "./openplc";
import { registerTheme } from "../_.register";

jest.mock("../_.register", () => ({
  registerTheme: jest.fn(),
}));

describe("openplc.ts", () => {
  test("should export lightThemeData and darkThemeData", () => {
    expect(lightThemeData).toBeDefined();
    expect(darkThemeData).toBeDefined();
  });
});

describe("open-plc.ts", () => {
  test("should register open-plc theme", () => {
    registerTheme("openplc-light", lightThemeData);
    registerTheme("openplc-dark", darkThemeData);
    expect(registerTheme).toHaveBeenCalledWith("openplc-light", lightThemeData);
    expect(registerTheme).toHaveBeenCalledWith("openplc-dark", darkThemeData);
  });
});
