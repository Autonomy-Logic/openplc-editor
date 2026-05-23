// Empty sketch used as `arduino-cli compile --show-properties=expanded` target.
// We never actually compile this — we only ask arduino-cli to resolve every
// platform/board property for a given FQBN so the editor can feed those
// values into its own pre-compile pipeline (see CompilerModule.extractToolchainProperties).
void setup() {}
void loop() {}
