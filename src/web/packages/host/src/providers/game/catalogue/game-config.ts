/** Xbox titles and GDK Appx packages share this config file name. */
export const GAME_CONFIG_FILE = "MicrosoftGame.config";

/**
 * `MicrosoftGame.config` is XML; this takes its executable without a parser.
 * The GDK shape is `<ExecutableList><Executable Name="X.exe" …/></ExecutableList>`.
 * Xbox titles and GDK Appx packages share it, so one function owns the rules.
 */
const GAME_EXECUTABLE_PATTERN = /<Executable\b[^>]*\bName\s*=\s*"([^"]+)"/i;

export function executableFromGameConfig(text: string): string | undefined {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");
  const value = GAME_EXECUTABLE_PATTERN.exec(withoutComments)?.[1]?.trim();

  return value === undefined || value === "" ? undefined : value;
}
