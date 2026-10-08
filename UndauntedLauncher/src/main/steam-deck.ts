import { readFileSync } from "node:fs";

function readOptional(file: string): string {
  try { return readFileSync(file, "utf8").trim(); }
  catch { return ""; }
}

export function isSteamDeck(
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = readOptional,
): boolean {
  if (env.DAUNTLESS_REVIVED_STEAM_DECK === "0") return false;
  if (env.DAUNTLESS_REVIVED_STEAM_DECK === "1") return true;

  const osRelease = read("/etc/os-release");
  if (/^VARIANT_ID=["']?steamdeck["']?\s*$/im.test(osRelease)) return true;

  const vendor = read("/sys/class/dmi/id/sys_vendor");
  const product = read("/sys/class/dmi/id/product_name");
  return /^valve(?: corporation)?$/i.test(vendor) && /^(jupiter|galileo)$/i.test(product);
}
