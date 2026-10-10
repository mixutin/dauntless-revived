// Fixed values: pinned hashes, file locations and the few public URLs the launcher may open.

export const APP_ID = "io.github.mixutin.dauntlessrevived";
export const SQUIRREL_NAME = "DauntlessRevivedLauncher";
export const PROJECT_URL = "https://github.com/mixutin/dauntless-revived";
export const PROJECT_LICENSE_URL = "https://github.com/mixutin/dauntless-revived/blob/dauntless-revived/LICENSE.txt";
export const PROJECT_CONTRIBUTORS_URL = "https://github.com/mixutin/dauntless-revived/graphs/contributors";
// Undaunted, the project this launcher and the whole fork are a modified version of.
export const UPSTREAM_URL = "https://github.com/SyST3MDeV/Undaunted";
export const UPSTREAM_CONTRIBUTORS_URL = "https://github.com/SyST3MDeV/Undaunted/graphs/contributors";
export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
export const VC_REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
// Self-update feed: a rolling GitHub release that the release workflow keeps current
// (update.electronjs.org only reads plain semver tags, and launcher releases are tagged launcher-v*).
export const UPDATE_FEED_URL = "https://github.com/mixutin/dauntless-revived/releases/download/launcher-updates";

// Game layout (paths relative to the folder that contains Archon/).
export const WIN64_RELATIVE_DIR = "Archon/Binaries/Win64";
export const EXE_NAME = "Dauntless-Win64-Shipping.exe";
export const EXE_RELATIVE_PATH = `${WIN64_RELATIVE_DIR}/${EXE_NAME}`;
export const PINNED_EXE_SHA256 = "d3d41e614908d2befd518b27046d9822d6130ef12ba3504babbdb786bef9cff4";
export const PINNED_EXE_SIZE = 103673520;

export interface PinnedDll {
  name: string;
  sha256: string;
}

// Same pins as friend-kit/play.ps1. The files ship in the launcher's resources.
export const PINNED_DLLS: readonly PinnedDll[] = [
  { name: "dxgi.dll", sha256: "9a431d7b6fd20c43fa92bebd91c3bc023ec7a3fcbc52871c41f4df293d4b0d1f" },
  { name: "UndauntedInternalServer.dll", sha256: "a090e8b25044647ce409b313525501da578d632d3fcb9eb351f020ca94fa64fb" },
];
export const DLL_RELATIVE_PATHS = PINNED_DLLS.map((d) => `${WIN64_RELATIVE_DIR}/${d.name}`);

// The server DLL needs the Visual C++ 2015-2022 runtime (x64).
export const VC_RUNTIME_FILES = ["MSVCP140.dll", "VCRUNTIME140_1.dll"];

// Chat and presence (XMPP): pointed at the host instead of Epic, like friend-kit/play.ps1.
export const XMPP_PORT = 61099;

export const CONNECT_TIMEOUT_MS = 5000;
export const STATUS_POLL_MS = 15000;
export const DISK_MARGIN_BYTES = 1024 * 1024 * 1024; // 1 GiB on top of what is still to download
export const DOWNLOAD_CONCURRENCY = 4;
