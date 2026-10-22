// Dauntless Revived Launcher - Electron main process.
//
// Security model: the renderer is sandboxed, has no Node access and no network access at all
// (every request is made here, in the main process, and only to the host from the invite). It can
// only call the small typed API in preload.ts, and every argument is checked again here.

import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, screen, session, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { freemem } from "node:os";
import { PortableOfflineSave } from "./main/offline-save";
import { electronSaveDatabase } from "./main/offline-save-runtime";
import { offlineLayout } from "./main/offline-layout";
import { KeyStore, type Encryptor } from "./main/keystore";
import { existsSync, promises as fsp } from "node:fs";
import { pathToFileURL } from "node:url";
import started from "electron-squirrel-startup";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { Controller, type Platform, type OfflineStackSession } from "./main/controller";
import { GAME_MANIFEST, GAME_MANIFEST_FINGERPRINT, GAME_MANIFEST_PROBLEM } from "./main/game-manifest";
import { findRunningClients } from "./main/launch";
import { LinuxRuntimeMissingError, prepareLinuxGameLaunch } from "./main/linux-runtime";
import {
  linuxDependencyInstallPlan,
  repairLinuxDesktopEnvironment,
  runLinuxDependencyInstall,
} from "./main/linux-dependencies";
import { findLinuxUpdate, installLinuxUpdate, type LinuxUpdate } from "./main/linux-updater";
import { findTailscale } from "./main/system";
import { describeError, log, logToFile } from "./main/log";
import { boundedString, externalTarget, isTrustedPageUrl, relayPortOverride, settingsPatch } from "./main/ipc-validate";
import { INVITE_SCHEME, parseInvite } from "./shared/invite";
import { IPC, type Snapshot, type OfflineStatus, type TaskProgress } from "./shared/types";
import { systemLanguage, translate } from "./shared/i18n";
import { APP_ID, SQUIRREL_NAME, UPDATE_FEED_URL } from "./main/constants";
import { LocalStackManager } from "./main/local-stack";
import { makeLocalStack } from "./main/local-stack-factory";

// Squirrel install / update / uninstall events: create or remove shortcuts, then quit.
if (started) app.quit();

// Repair a stripped desktop environment (for example when launched by a helper) before Chromium
// chooses its Linux password-store backend. GNOME-family desktops use Secret Service/libsecret.
const linuxDesktop = repairLinuxDesktopEnvironment();
if (
  process.platform === "linux" &&
  linuxDesktop.forceGnomeLibsecret &&
  !process.argv.some((arg) => arg.startsWith("--password-store="))
) {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}

// Every renderer runs in the Chromium sandbox, whatever a window's own options say.
app.enableSandbox();
if (process.argv.includes("--safe-mode")) app.disableHardwareAcceleration();
nativeTheme.themeSource = "dark";
app.setAppUserModelId(process.platform === "win32" && app.isPackaged ? `com.squirrel.${SQUIRREL_NAME}.${SQUIRREL_NAME}` : APP_ID);

// Art from the host's art pack is served to the renderer through this app-internal scheme.
protocol.registerSchemesAsPrivileged([{ scheme: "dr-art", privileges: { standard: true, secure: true } }]);

const DEV_SERVER_URL: string | undefined = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const RENDERER_INDEX = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
const RENDERER_INDEX_URL = pathToFileURL(RENDERER_INDEX).toString();

// The same policy as the page's own meta tag, sent as a header where one can be sent (dev server).
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' dr-art: data:; font-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
let mainWindow: BrowserWindow | null = null;
let controller: Controller | null = null;
let pendingInviteLink: string | null = null;
let quitting = false;
let linuxUpdate: LinuxUpdate | null = null;
let localStack: LocalStackManager | null = null;


function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "assets");
}

function makeLauncherLocalStack(): LocalStackManager | null {
  const stack = makeLocalStack({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    userDataDir: app.getPath("userData"),
    appPath: app.getAppPath(),
    env: process.env,
    gameRoot: () => {
      if (!controller) throw new Error("Launcher controller is not ready");
      return controller.installDir;
    },
  });
  stack?.onChange((snapshot) => {
    log.info(
        `local stack: ${snapshot.state}` +
        (snapshot.error ? ` (${snapshot.error})` : ""),
    );
  });
  return stack;
}
async function startLocalOfflineStack(onPhase: (phase: "starting-metagame" | "starting-deploy") => void,): Promise<OfflineStackSession | null> {const stack = localStack;
  if (!stack) return null;
  const unsubscribe = stack.onChange((snapshot) => {
    if (snapshot.state === "starting-metagame" || snapshot.state === "starting-deploy") {onPhase(snapshot.state);}});
  try {
    if (stack.snapshot.state === "stopped" || stack.snapshot.state === "failed") {await stack.start();}} finally {unsubscribe();}
  if (stack.snapshot.state !== "ready") {throw new Error(`local stack is not ready (${stack.snapshot.state})`);}
  return {
    endpoint: {
      host: "127.0.0.1",
      port: 61000,
      pin: null,
    },
    stop: () => stack.stop(),
  };
}

async function ensureLinuxSecureStorageDependency(): Promise<boolean> {
  if (process.platform !== "linux" || safeStorage.isEncryptionAvailable()) return false;
  const backend = safeStorage.getSelectedStorageBackend();
  log.warn(`secure storage unavailable (backend ${backend})`);
  if (
    !app.isPackaged ||
    process.env.DAUNTLESS_REVIVED_AUTO_INSTALL === "0" ||
    process.env.DAUNTLESS_REVIVED_STORAGE_BOOTSTRAPPED === "1"
  ) {
    return false;
  }

  const plan = linuxDependencyInstallPlan("secure-storage");
  if (!plan) return false;
  log.info(`installing Linux secure-storage dependencies with ${plan.name}`);
  try {
    await runLinuxDependencyInstall(plan);
    log.info("Linux secure-storage dependencies installed; restarting launcher");
    process.env.DAUNTLESS_REVIVED_STORAGE_BOOTSTRAPPED = "1";
    app.relaunch();
    app.exit(0);
    return true;
  } catch (e) {
    log.error(`secure-storage dependency install failed: ${describeError(e)}`);
    return false;
  }
}

// ------------------------------------------------------------------ invite links

function inviteFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.toLowerCase().startsWith(`${INVITE_SCHEME}:`)) {
      return parseInvite(arg).ok ? arg.trim() : null;
    }
  }
  return null;
}

function deliverInviteLink(link: string | null): void {
  if (!link) return;
  pendingInviteLink = link;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.inviteLink);
}

function registerProtocolClient(): void {
  if (!app.isPackaged) return; // a dev build must not take over the scheme
  // Squirrel keeps a stub exe one folder up that always starts the newest version on Windows.
  const stub = path.resolve(path.dirname(process.execPath), "..", path.basename(process.execPath));
  const target = process.platform === "win32" && existsSync(stub) ? stub : process.execPath;
  if (!app.setAsDefaultProtocolClient(INVITE_SCHEME, target, [])) log.warn("could not register the invite link handler");
}

// ------------------------------------------------------------------ window

function createWindow(): void {
  const iconPath = path.join(resourcesDir(), "icon.png");
  // Never larger than the primary screen's usable area (the part the taskbar does not cover):
  // 1366x768 laptops, or 1920x1080 at 150 % scaling, have less than 760 px of height, and the big
  // button at the bottom must stay on screen.
  const work = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1280, work.width),
    height: Math.min(760, work.height),
    minWidth: Math.min(1024, work.width),
    minHeight: Math.min(640, work.height),
    frame: false,
    show: false,
    // The page's ink (styles.css), so nothing flashes before it paints.
    backgroundColor: "#01090D",
    title: "Dauntless Revived Launcher",
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      safeDialogs: true,
      disableBlinkFeatures: "Auxclick",
    },
  });
  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const window = mainWindow;
  const showTimer = setTimeout(() => { if (!window.isDestroyed()) window.show(); }, 10000);
  window.once("closed", () => clearTimeout(showTimer));
  window.webContents.on("render-process-gone", (_event, details) => {
    log.error(`launcher renderer stopped: ${details.reason}`);
    if (!process.argv.includes("--safe-mode") && !controller?.relayActive && !controller?.offlineGameActive) {
      app.relaunch({args: [...process.argv.slice(1), "--safe-mode"]});
      app.exit(0);
    } else {
      dialog.showErrorBox("Dauntless Revived could not open", "The launcher renderer stopped. Reinstall the latest launcher and send the launcher logs to support.");
    }
  });
  mainWindow.on("maximize", () => mainWindow?.webContents.send(IPC.windowState, true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send(IPC.windowState, false));

  // Public relay and offline play both depend on launcher-owned background processes.
  // Closing the launcher underneath either one would disconnect the running game.
  mainWindow.on("close", (event) => {
    if (quitting || !controller || !mainWindow) return;

    const closeReason = controller.offlineGameActive
        ? "offline"
        : controller.relayActive
            ? "relay"
            : null;

    if (closeReason === null) return;

    const lang = controller.snapshot().settings.language;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      title: translate(lang, "app_title"),
      message: translate(lang, "close_title"),
      detail: translate(
          lang,
          closeReason === "offline" ? "close_text_offline" : "close_text",
      ),
      buttons: [
        translate(lang, "close_keep"),
        translate(lang, "close_anyway"),
      ],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (choice === 0) {
      event.preventDefault();
      mainWindow.minimize();

      if (closeReason === "relay") controller.setNotice("keep_open");
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const loaded = DEV_SERVER_URL ? mainWindow.loadURL(DEV_SERVER_URL) : mainWindow.loadFile(RENDERER_INDEX);
  void loaded.catch((error) => {
    log.error(`launcher page failed: ${describeError(error)}`);
    dialog.showErrorBox("Dauntless Revived could not open", "The launcher page could not load. Reinstall the latest launcher. Your account and game files are kept.");
  });
}

function hardenSessions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  // The renderer may load its own files and the dr-art images, nothing from the network.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith("file:") ||
      url.startsWith("dr-art:") ||
      url.startsWith("devtools:") ||
      url.startsWith("data:") ||
      (DEV_SERVER_URL !== undefined && isTrustedPageUrl(url, DEV_SERVER_URL, RENDERER_INDEX_URL)) ||
      (DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL.replace(/^http/, "ws")));
    callback({ cancel: !allowed });
  });
  if (DEV_SERVER_URL) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP.replace("connect-src 'self'", "connect-src 'self' ws:")] } });
    });
  }

  protocol.handle("dr-art", async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.replace(/^\//, "");
      const art = url.hostname === "bg" && controller ? controller.resolveArt(id) : null;
      if (!art) return new Response(null, { status: 404 });
      const data = await fsp.readFile(art.file);
      return new Response(data, { status: 200, headers: { "content-type": art.type, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedPageUrl(url, DEV_SERVER_URL, RENDERER_INDEX_URL)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isTrustedPageUrl(url, DEV_SERVER_URL, RENDERER_INDEX_URL)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

// ------------------------------------------------------------------ IPC

function trusted(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    frame !== null &&
    frame === mainWindow.webContents.mainFrame &&
    isTrustedPageUrl(frame.url, DEV_SERVER_URL, RENDERER_INDEX_URL)
  );
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) {
      log.warn(`refused IPC ${channel} from an untrusted frame`);
      throw new Error("refused");
    }
    try {
      return await fn(event, ...args);
    } catch (e) {
      log.error(`IPC ${channel} failed: ${describeError(e)}`);
      return { ok: false, error: { code: "unknown" } };
    }
  });
}

function registerIpc(c: Controller): void {
  // Offline play's save backups. The file dialogs stay in the main process: the page never names a path.
  handle(IPC.offlineExportSave, async () => {
    if (!mainWindow) return { ok: false, error: { code: "cancelled" } };
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath("documents"), `Dauntless Revived offline save ${stamp}.drsave`),
      filters: [{ name: "Dauntless Revived offline save", extensions: ["drsave"] }],
      properties: ["dontAddToRecent", "showOverwriteConfirmation"],
    });
    return r.canceled || !r.filePath ? { ok: false, error: { code: "cancelled" } } : c.exportOfflineSave(r.filePath);
  });
  handle(IPC.offlineImportSave, async () => {
    if (!mainWindow) return { ok: false, error: { code: "cancelled" } };
    const r = await dialog.showOpenDialog(mainWindow, {
      defaultPath: app.getPath("documents"),
      filters: [{ name: "Dauntless Revived offline save", extensions: ["drsave"] }],
      properties: ["openFile", "dontAddToRecent"],
    });
    return r.canceled || r.filePaths.length !== 1 ? { ok: false, error: { code: "cancelled" } } : c.importOfflineSave(r.filePaths[0]);
  });
  handle(IPC.getSnapshot, () => c.snapshot());
  handle(IPC.checkInvite, (_e, text) => {
    const s = boundedString(text, 2048);
    return s === null ? { ok: false, error: { code: "invite_invalid_format" } } : c.checkInvite(s);
  });
  handle(IPC.submitInvite, (_e, text, acceptNewCertificate) => {
    const s = boundedString(text, 2048);
    return s === null ? { ok: false, error: { code: "invite_invalid_format" } } : c.submitInvite(s, { acceptNewCertificate: acceptNewCertificate === true });
  });
  handle(IPC.retryConnect, () => c.connect());
  handle(IPC.forgetServer, () => c.forgetServer());
  handle(IPC.switchServer, (_e, id) => (typeof id === "string" && /^[0-9a-f]{24}$/.test(id) ? c.switchServer(id) : { ok: false, error: { code: "invite_invalid_format" } }));
  handle(IPC.removeSavedServer, (_e, id) => (typeof id === "string" && /^[0-9a-f]{24}$/.test(id) ? c.removeSavedServer(id) : { ok: false, error: { code: "invite_invalid_format" } }));
  handle(IPC.register, (_e, username) => {
    const s = boundedString(username, 32);
    return s === null ? { ok: false, error: { code: "username_invalid" } } : c.register(s);
  });
  handle(IPC.useExistingKey, (_e, text) => {
    const s = boundedString(text, 8192);
    return s === null ? { ok: false, error: { code: "key_invalid" } } : c.useExistingKey(s);
  });
  handle(IPC.importKeyFile, () => c.importKeyFile());
  handle(IPC.joinFromBackupFile, () => c.joinFromBackupFile());
  handle(IPC.saveKeyBackup, () => c.saveKeyBackup());
  handle(IPC.dismissBackupOffer, () => c.dismissBackupOffer());
  handle(IPC.chooseInstallDir, () => c.chooseInstallDir());
  handle(IPC.useExistingGameFolder, () => c.useExistingGameFolder());
  handle(IPC.useExistingGamePath, (_e, value) => {
    const s = boundedString(value, 260);
    return s === null ? { ok: false, error: { code: "folder_invalid" } } : c.useExistingGamePath(s);
  });
  handle(IPC.startInstall, () => c.startInstall());
  handle(IPC.pauseTask, () => c.pauseTask());
  handle(IPC.resumeTask, () => c.resumeTask());
  handle(IPC.cancelTask, () => c.cancelTask());
  handle(IPC.repair, () => c.repair());
  handle(IPC.play, () => c.play());
  handle(IPC.startOffline, (_e, username) => {
    if (username === undefined) return c.startOffline();
    const s = boundedString(username, 32);
    return s === null
        ? { ok: false, error: { code: "username_invalid" } }
        : c.startOffline(s);
  });
  handle(IPC.stopOffline, () => c.stopOffline());
  handle(IPC.offlineStatus, () => c.offlineStatus());
  handle(IPC.setSettings, (_e, patch) => {
    const p = settingsPatch(patch);
    return p === null ? c.setSettings({}) : c.setSettings(p);
  });
  handle(IPC.setStatusPolling, (_e, on) => {
    if (typeof on === "boolean") c.setStatusPolling(on);
  });
  handle(IPC.refreshStatus, () => c.refreshStatus());
  handle(IPC.getNews, () => c.getNews());
  handle(IPC.getBranding, () => c.getBranding());
  handle(IPC.openExternal, (_e, target) => {
    const t = externalTarget(target);
    return t === null ? { ok: false, error: { code: "unknown" } } : c.openExternal(t);
  });
  handle(IPC.openGameFolder, () => c.openGameFolder());
  handle(IPC.logout, () => c.logout());
  handle(IPC.installUpdate, () => c.installUpdate());
  handle(IPC.dismissNotice, () => c.dismissNotice());
  handle(IPC.dismissError, () => c.dismissError());
  handle(IPC.windowMinimize, () => mainWindow?.minimize());
  handle(IPC.windowMaximize, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handle(IPC.windowClose, () => mainWindow?.close());
  handle(IPC.takeInviteLink, () => {
    const link = pendingInviteLink;
    pendingInviteLink = null;
    return link;
  });
}

// ------------------------------------------------------------------ platform for the controller

function makePlatform(): Platform {
  const send = (channel: string, payload: Snapshot | TaskProgress | OfflineStatus) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  const localAppData = process.env.LOCALAPPDATA ?? path.join(app.getPath("home"), "AppData", "Local");
  const defaultInstallDir =
    process.platform === "linux" ? path.join(app.getPath("home"), "Games", "DauntlessRevived") : path.join(localAppData, "DauntlessRevived", "Game");
  const relayPort = relayPortOverride(process.env.DAUNTLESS_REVIVED_RELAY_PORT);
  if (relayPort !== undefined) log.warn(`relay port overridden to ${relayPort}`);
  const encryptor: Encryptor = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: plain => safeStorage.encryptString(plain),
    decrypt: data => safeStorage.decryptString(data),
  };
  const layout = offlineLayout(process.resourcesPath, app.getPath("userData"));
  return {
    userDataDir: app.getPath("userData"),
    documentsDir: app.getPath("documents"),
    resourcesDir: resourcesDir(),
    defaultInstallDir,
    hostPlatform: process.platform,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    defaultLanguage: systemLanguage(app.getLocale()),
    systemLocale: app.getLocale(),
    relayPort,
    encryptor,
    offlineSave: app.isPackaged && process.platform === "win32" ? new PortableOfflineSave({
      layout, userData: app.getPath("userData"),
      keys: new KeyStore(path.join(app.getPath("userData"), "keys"), encryptor),
      database: electronSaveDatabase(layout.runtimeRoot, layout.metagameDir),
      isActive: () => (!!localStack && !["stopped", "failed"].includes(localStack.snapshot.state)) ||
        !!controller?.snapshot().game.running || !!controller?.snapshot().task || controller?.offlineStatus().phase === "stopping",
    }) : undefined,
    manifest: GAME_MANIFEST,
    chooseFolder: async (purpose, defaultPath) => {
      if (!mainWindow) return null;
      const lang = controller?.snapshot().settings.language ?? "en";
      const r = await dialog.showOpenDialog(mainWindow, {
        title: translate(lang, purpose === "existing" ? "dialog_existing_folder" : "dialog_install_folder"),
        defaultPath: existsSync(defaultPath) ? defaultPath : undefined,
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
      });
      return r.canceled || r.filePaths.length !== 1 ? null : r.filePaths[0];
    },
    chooseSaveFile: async (defaultName) => {
      if (!mainWindow) return null;
      const r = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(app.getPath("documents"), defaultName),
        filters: [{ name: "Text", extensions: ["txt"] }],
        properties: ["dontAddToRecent", "showOverwriteConfirmation"],
      });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    chooseOpenFile: async () => {
      if (!mainWindow) return null;
      const r = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: "Text", extensions: ["txt"] }],
        properties: ["openFile", "dontAddToRecent"],
      });
      return r.canceled || r.filePaths.length !== 1 ? null : r.filePaths[0];
    },
    openExternal: (url) => shell.openExternal(url),
    openPath: async (dir) => {
      await shell.openPath(dir);
    },
    emitSnapshot: (s) => send(IPC.snapshot, s),
    emitProgress: (p) => send(IPC.progress, p),
    emitOfflineStatus: (s) => send(IPC.offlineStatusChanged, s),
    findTailscale: () => findTailscale(process.env, existsSync, process.platform),
    findRunningClients: () => findRunningClients(process.platform),
    startOfflineStack: localStack ? (onPhase) => startLocalOfflineStack(onPhase) : undefined,
    // Development stacks retain their own configured admission policy.
    offlineFreeMemory: app.isPackaged && process.platform === "win32" ? freemem : undefined,
    prepareGameLaunch:
      process.platform === "linux"
        ? async () => {
            try {
              return await prepareLinuxGameLaunch(
                app.getPath("userData"),
                process.env,
                app.getPath("home"),
                { autoInstallRuntime: app.isPackaged },
              );
            } catch (e) {
              if (e instanceof LinuxRuntimeMissingError) return null;
              throw e;
            }
          }
        : undefined,
    installUpdate: () => {
      if (app.isPackaged && process.platform === "win32") {
        quitting = true;
        autoUpdater.quitAndInstall();
      } else if (app.isPackaged && process.platform === "linux" && linuxUpdate) {
        void installLinuxUpdate(linuxUpdate).then(() => { quitting = true; app.quit(); }).catch((e) => log.error(`update: Linux install failed: ${describeError(e)}`));
      }
    },
  };
}

// ------------------------------------------------------------------ startup

if (!started) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    pendingInviteLink = inviteFromArgv(process.argv);

    app.on("second-instance", (_event, argv) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      deliverInviteLink(inviteFromArgv(argv));
    });

    app.whenReady().then(async () => {
      Menu.setApplicationMenu(null);
      logToFile(path.join(app.getPath("userData"), "logs"));
      log.info(`Dauntless Revived Launcher ${app.getVersion()} starting`);
      localStack = makeLauncherLocalStack();
      if (process.platform === "linux") {
        log.info(
          `secure storage backend ${safeStorage.getSelectedStorageBackend()}, encryption ${safeStorage.isEncryptionAvailable() ? "available" : "unavailable"}`,
        );
        if (await ensureLinuxSecureStorageDependency()) return;
      }
      if (GAME_MANIFEST) log.info(`game manifest ${GAME_MANIFEST.files.length} files, fingerprint ${GAME_MANIFEST_FINGERPRINT}`);
      else log.error(`compiled-in game manifest is not usable: ${GAME_MANIFEST_PROBLEM}`);

      registerProtocolClient();
      hardenSessions();
      controller = new Controller(makePlatform());
      registerIpc(controller);
      createWindow();
      await controller.init();

      if (app.isPackaged && process.platform === "linux") {
        const check = async () => {
          try {
            linuxUpdate = await findLinuxUpdate();
            if (linuxUpdate) controller?.setUpdateReady();
          } catch (e) {
            log.warn(`update: Linux check failed: ${describeError(e)}`);
          }
        };
        void check();
        setInterval(() => void check(), 60 * 60 * 1000).unref();
      }

      if (app.isPackaged && process.platform === "win32") {
        updateElectronApp({
          updateSource: { type: UpdateSourceType.StaticStorage, baseUrl: UPDATE_FEED_URL },
          updateInterval: "1 hour",
          notifyUser: true,
          onNotifyUser: () => controller?.setUpdateReady(),
          logger: { log: (m) => log.info(`update: ${m}`), info: (m) => log.info(`update: ${m}`), warn: (m) => log.warn(`update: ${m}`), error: (m) => log.error(`update: ${m}`) },
        });
      }
    }).catch((error) => {
      log.error(`launcher startup failed: ${describeError(error)}`);
      dialog.showErrorBox("Dauntless Revived could not open", `Startup failed. Send the launcher logs to support.\n${describeError(error)}`);
      app.exit(1);
    });

    app.on("before-quit", () => {
      quitting = true;
    });

    app.on("window-all-closed", () => {
      const c = controller;
      const stack = localStack;
      controller = null;
      localStack = null;

      const shutdown = c
          ? c.shutdown()
          : stack
              ? stack.stop()
              : Promise.resolve();

      void shutdown.finally(() => app.quit());
    });
  }
}
