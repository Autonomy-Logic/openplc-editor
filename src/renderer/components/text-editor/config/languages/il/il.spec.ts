import { registerLanguage } from "../_.register";
import {
  conf as languageConfiguration,
  language as monarchLanguage,
} from "./il";
import { conf, language } from "./il";
import * as monaco from "monaco-editor";

// Mock the 'registerLanguage' function using Jest's mock functionality.
jest.mock("../_.register", () => ({
  registerLanguage: jest.fn(),
}));

// Test suite for IL language-related functionality.
describe("IL language tests", () => {
  // Test case: It should register IL language.
  it("should register IL language", () => {
    // Call the function you want to test.
    registerILLanguage();

    // Verify if the 'registerLanguage' function was called with the expected arguments.
    expect(registerLanguage).toHaveBeenCalledWith({
      def: {
        id: "il",
        extensions: [".il"],
        aliases: ["il"],
        mimetypes: ["text/instruction-list"],
      },
      conf,
      language,
    });
  });
  test("IL language configuration is valid", () => {
    // Validate the IL language configuration
    const isValidLanguageConfiguration =
      languageConfiguration as monaco.languages.LanguageConfiguration;
    expect(isValidLanguageConfiguration).toBeTruthy();
  });

  test("IL monarch language is valid", () => {
    // Validate the IL monarch language
    const isValidMonarchLanguage =
      monarchLanguage as monaco.languages.IMonarchLanguage;
    expect(isValidMonarchLanguage).toBeTruthy();
  });
});

// Function to be tested: It calls 'registerLanguage' with specific IL language configuration.
function registerILLanguage() {
  registerLanguage({
    def: {
      id: "il",
      extensions: [".il"],
      aliases: ["il"],
      mimetypes: ["text/instruction-list"],
    },
    conf,
    language,
  });
}
