// The launcher's page. It draws the Snapshots the main process sends and turns clicks into the
// small set of calls in preload.ts. It has no network access of its own: news, art and status
// all come through the main process.

import { $, forceRender, githubMark, h, icon, renderRegion, type IconName } from "./dom";
import partnerLogo from "./brand/eugamehost-partner.png";
import newsBadge from "./brand/news-badge.svg";
import { buildScene } from "./scene";
import { isStringKey, translate, type StringKey } from "../shared/i18n";
import { localized, PATRONS, PROJECT_PEOPLE, SOFTWARE, UPSTREAM_PEOPLE, type CreditPerson, type CreditRole } from "../shared/credits";
import { parseInvite } from "../shared/invite";
import { checkUsername, extractAccountKey } from "../shared/username";
import { exposureKey, graphicsKey, primaryButton, shortFile, stepIndex, taskView, updateReason, whereKey } from "../shared/ui-model";
import { formatBytes, formatDate, formatDuration, formatRunningTime } from "../shared/format";
import { sortInstances, type InstanceKind, type ServerStatus, type StatusInstance } from "../shared/status";
import { EXPOSURE_MODES, GAME_LANGUAGES, GRAPHICS_PRESETS, LANGUAGES, type Branding, type ExposureMode, type ExternalTarget, type GameLanguage, type GraphicsPreset, type Language, type LauncherError, type NewsItem, type Snapshot, type TaskProgress } from "../shared/types";

type View = "play" | "news" | "server" | "settings" | "partners" | "mods" | "credits";
const VIEWS: readonly View[] = ["play", "news", "server", "settings", "partners", "mods", "credits"];
type Modal =
  | { kind: "invite"; link: string; name: string; host: string; mode: "public" | "private"; fp: string | null }
  // A public invite whose certificate is not the one this PC's key for that server belongs to.
  | { kind: "cert_changed"; link: string; name: string; host: string; oldFp: string | null; newFp: string }
  | { kind: "logout" }
  | { kind: "leave" }
  | { kind: "remove_server"; id: string; name: string };

const api = window.launcher;
const ART_URL = /^dr-art:\/\/bg\/[0-9a-f]{64}$/;
const TIME_LOCALES: Record<Language, string> = { en: "en-GB", fi: "fi-FI", es: "es-ES" };
const GAME_LANGUAGE_NAMES: Record<Exclude<GameLanguage, "auto">, string> = { "en-US": "English", "de-DE": "Deutsch", "es-ES": "Español", "fr-FR": "Français", "it-IT": "Italiano", "ja-JP": "日本語", "pt-BR": "Português (Brasil)", "ru-RU": "Русский" };

const state = {
  snap: null as Snapshot | null,
  task: null as TaskProgress | null,
  lang: "en" as Language,
  view: "play" as View,
  inviteText: "",
  revealed: new Set<string>(), // streamer mode: the values shown with the eye, until the launcher closes
  username: "",
  keyFormOpen: false,
  existingFormOpen: false,
  news: [] as NewsItem[],
  newsSeen: false,
  serverMenu: false, // the rail's server switcher is open
  branding: { backgrounds: [], accent: null } as Branding,
  extrasFor: "",
  extrasAt: 0,
  localError: null as LauncherError | null,
  modal: null as Modal | null,
  modalReturnFocus: null as HTMLElement | null,
  // Where Escape on the Credits page goes back to: the page and the button that opened it.
  creditsReturn: null as { view: View; focus: HTMLElement | null } | null,
  maximized: false,
  artIndex: -1,
  artTimer: 0 as number,
  artLayer: 0,
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function t(key: StringKey, vars?: Record<string, string | number>): string {
  return translate(state.lang, key, vars);
}

function tk(key: string, vars?: Record<string, string | number>): string {
  return isStringKey(key) ? t(key, vars) : key;
}

// ------------------------------------------------------------------ persistent inputs

const inviteInput = h("textarea", {
  class: "textarea",
  id: "invite-input",
  rows: 3,
  spellcheck: "false",
  autocomplete: "off",
  "data-fk": "invite",
  "aria-describedby": "invite-hint",
});
const inviteHint = h("div", { class: "hint", id: "invite-hint", "aria-live": "polite" });
const invitePreview = h("div", { class: "preview", hidden: true });

const usernameInput = h("input", {
  class: "input input-big",
  id: "username-input",
  type: "text",
  maxlength: 16,
  spellcheck: "false",
  autocomplete: "off",
  "data-fk": "username",
  "aria-describedby": "username-hint",
});
const usernameHint = h("div", { class: "hint", id: "username-hint", "aria-live": "polite" });

const keyInput = h("input", {
  class: "input",
  id: "key-input",
  type: "password",
  spellcheck: "false",
  autocomplete: "off",
  "data-fk": "key",
});

// "I already have the game files": a path to paste (Vvoidddd, #8). The main process checks it again.
const existingGameInput = h("input", {
  class: "input",
  id: "existing-game-path",
  type: "text",
  maxlength: 260,
  spellcheck: "false",
  autocomplete: "off",
  "data-fk": "existing-path",
});
existingGameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void useExistingPath();
  }
});

inviteInput.addEventListener("input", () => {
  state.inviteText = inviteInput.value;
  updateInviteFeedback();
  renderActionBar();
});
inviteInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void onPrimary();
  }
});
usernameInput.addEventListener("input", () => {
  state.username = usernameInput.value;
  updateUsernameFeedback();
  renderActionBar();
});
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void onPrimary();
  }
});
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void useKey();
  }
});

function clearInviteInput(): void {
  state.inviteText = "";
  inviteInput.value = "";
  updateInviteFeedback();
}

function formState() {
  return {
    inviteValid: parseInvite(state.inviteText).ok,
    usernameValid: checkUsername(state.username.trim()) === "ok",
  };
}

function groupedFingerprint(fp: string): string {
  return fp.match(/.{1,4}/g)?.join(" ") ?? fp;
}

// The first 16 hex digits, enough to compare with what the host shows.
function shortFingerprint(fp: string): string {
  return `${groupedFingerprint(fp.slice(0, 16))}…`;
}

function modeBadge(mode: "public" | "private"): HTMLElement {
  return mode === "public"
    ? h("span", { class: "badge badge-public" }, icon("shield"), t("mode_public"))
    : h("span", { class: "badge badge-private" }, icon("tunnel"), t("mode_private"));
}

function updateInviteFeedback(): void {
  const text = state.inviteText.trim();
  invitePreview.replaceChildren();
  if (text.length === 0) {
    invitePreview.hidden = true;
    inviteInput.removeAttribute("aria-invalid");
    inviteHint.className = "hint";
    inviteHint.replaceChildren(t("join_hint"));
    return;
  }
  const r = parseInvite(text);
  if (r.ok) {
    inviteInput.removeAttribute("aria-invalid");
    invitePreview.hidden = false;
    invitePreview.append(
      icon("check"),
      h(
        "div",
        { class: "preview-text" },
        h("div", { class: "preview-name" }, r.invite.name),
        h("div", { class: "preview-host" }, secret(`${r.invite.host}:${r.invite.port}`, "invite-host")),
        r.invite.fp ? h("div", { class: "preview-host mono" }, t("link_fingerprint", { fp: hideText(shortFingerprint(r.invite.fp)) })) : null,
      ),
      h("span", {}, modeBadge(r.invite.mode)),
    );
    inviteHint.className = "hint hint-ok";
    inviteHint.replaceChildren(t(r.invite.mode === "public" ? "join_ok_public" : "join_ok_private"));
  } else {
    invitePreview.hidden = true;
    inviteInput.setAttribute("aria-invalid", "true");
    inviteHint.className = "hint hint-bad";
    inviteHint.replaceChildren(icon("warning"), tk(`invite_err_${r.error}`));
  }
}

function updateUsernameFeedback(): void {
  const check = checkUsername(state.username.trim());
  usernameHint.className = check === "ok" ? "hint hint-ok" : state.username.length === 0 ? "hint" : "hint hint-bad";
  if (check === "ok") usernameHint.replaceChildren(icon("check"), t("reg_check_ok"));
  else usernameHint.replaceChildren(tk(`reg_check_${check}`));
  if (check !== "ok" && state.username.length > 0) usernameInput.setAttribute("aria-invalid", "true");
  else usernameInput.removeAttribute("aria-invalid");
}

// ------------------------------------------------------------------ streamer mode

// Streamer mode keeps what could identify a server or the PC off the screen: addresses, certificate
// fingerprints, the invite text, the install folder (it holds the Windows user name) and other
// players' names. A value that the player may need gets an eye button to show it for a moment.
function streamer(): boolean {
  return state.snap?.settings.streamerMode === true;
}

function hideText(text: string): string {
  return streamer() ? "\u2022\u2022\u2022\u2022\u2022\u2022" : text;
}

// A hidden value is never on screen: it is swapped for random letters and digits of the same length,
// and that filler is what gets blurred, so nothing can be recovered from a stream or a screenshot,
// even by tools that undo a blur. The filler is drawn once per value and kept until the launcher
// closes (the lists redraw often and must not flicker); it comes from the system's random source,
// never from the value itself. The same length keeps the layout still when the mode is switched; the
// eye floats beside the value without taking room.
const fillers = new Map<string, string>();
function filler(text: string): string {
  let out = fillers.get(text);
  if (out === undefined) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(Array.from(text).length));
    out = Array.from(bytes, (v) => chars[v % chars.length]).join("");
    fillers.set(text, out);
  }
  return out;
}

function blurred(text: string, cls = ""): HTMLElement {
  if (!streamer()) return h("span", { class: cls || undefined }, text);
  return h("span", { class: `${cls} secret-blur`.trim(), "aria-hidden": "true" }, filler(text));
}

function secret(text: string, key: string, cls = ""): HTMLElement {
  if (!streamer()) return h("span", { class: cls || undefined }, text);
  const shown = state.revealed.has(key);
  const eye = h("button", { type: "button", class: "secret-eye", title: t(shown ? "streamer_hide" : "streamer_show"), "aria-label": t(shown ? "streamer_hide" : "streamer_show"), "aria-pressed": shown ? "true" : "false" }, icon(shown ? "eye_off" : "eye"));
  eye.addEventListener("click", () => {
    if (shown) state.revealed.delete(key);
    else state.revealed.add(key);
    refreshSecrets();
  });
  return h("span", { class: "secret" }, h("span", { class: `${cls} ${shown ? "" : "secret-blur"}`.trim() || undefined, "aria-hidden": shown ? undefined : "true" }, shown ? text : filler(text)), eye);
}

function refreshSecrets(): void {
  document.documentElement.classList.toggle("streamer", streamer());
  inviteInput.classList.toggle("masked", streamer());
  for (const sel of ["#view-play", "#view-server", "#view-settings", "#server-panel", "#account-chip"]) forceRender($(sel));
  updateInviteFeedback();
  renderAll();
}

// ------------------------------------------------------------------ small builders

function card(cls: string, ...children: Parameters<typeof h>[2][]): HTMLElement {
  return h("div", { class: `card ${cls}`.trim() }, ...children);
}

function linkButton(label: string, onClick: () => void, opts: { icon?: IconName; fk?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = h("button", { type: "button", class: "link-btn", "data-fk": opts.fk, disabled: opts.disabled }, opts.icon ? icon(opts.icon) : null, label);
  b.addEventListener("click", onClick);
  return b;
}

// A risky action (btn-danger) always shows the warning sign, so it does not rely on its colour alone.
function button(label: string, onClick: () => void, opts: { cls?: string; icon?: IconName; fk?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const glyph = opts.icon ?? (opts.cls === "btn-danger" ? "warning" : undefined);
  const b = h("button", { type: "button", class: `btn ${opts.cls ?? ""}`.trim(), "data-fk": opts.fk, disabled: opts.disabled }, glyph ? icon(glyph) : null, label);
  b.addEventListener("click", onClick);
  return b;
}

function stat(label: string, value: string, small = false): HTMLElement {
  return h("div", { class: "stat" }, h("span", { class: "stat-label" }, label), h("span", { class: `stat-value${small ? " small" : ""}`, title: value }, value));
}

function serverName(): string {
  return state.snap?.status?.name ?? state.snap?.server?.name ?? "";
}

function open(target: ExternalTarget): void {
  void api.openExternal(target);
}

function errorText(e: LauncherError): string {
  switch (e.code) {
    case 'account_banned':
      return `You are banned from this server. Reason: ${e.detail || 'Contact support for details.'} You can appeal in Discord.`;
    case "invite_invalid_format":
      return e.detail ? tk(`invite_err_${e.detail}`) : t("err_invite_invalid_format");
    case "username_invalid":
      return e.detail && e.detail !== "ok" ? tk(`reg_check_${e.detail}`) : t("err_username_invalid");
    case "disk_space":
      return e.detail && /^\d+$/.test(e.detail) ? t("err_disk_space_need", { size: formatBytes(Number(e.detail), state.lang) }) : t("err_disk_space");
    case "relay_port_busy":
      return t("err_relay_port_busy", { port: e.detail && /^\d+$/.test(e.detail) ? e.detail : "61000" });
    case "server_unreachable":
      return t(state.snap?.server?.mode === "public" ? "err_server_unreachable_public" : "err_server_unreachable");
    case 'launch_failed':
    case 'windows_runtime_missing':
      return `${tk(`err_${e.code}`)}${e.detail ? ` ${e.detail}` : ''}`;

    default:
      return tk(`err_${e.code}`);
  }
}

// ------------------------------------------------------------------ play view

function vcWarning(snap: Snapshot): HTMLElement | null {
  const vc = snap.install.vcRuntimeMissing;
  const dx = snap.install.directXMissing ?? [];
  if (!vc.length && !dx.length) return null;
  return card('card-warn',
    ...(vc.length ? [h('h3', {class:'card-title'}, icon('warning'), t('vc_title')),
      h('p', {class:'card-text'}, t('vc_text', {files:vc.join(', ')})),
      linkButton(t('vc_button'), () => open('vc_redist'), {icon:'external',fk:'vc'})] : []),
    ...(dx.length ? [h('h3', {class:'card-title'}, icon('warning'), t('dx_title')),
      h('p', {class:'card-text'}, t('dx_text', {files:dx.join(', ')})),
      linkButton(t('dx_button'), () => open('directx_runtime'), {icon:'external',fk:'directx'})] : []),
  );
}

function eyebrow(snap: Snapshot): HTMLElement {
  return h("div", { class: "eyebrow" }, snap.server ? serverName() : t("join_eyebrow"), snap.server ? modeBadge(snap.server.mode) : null);
}

function heading(title: string, text: string | null): HTMLElement[] {
  const out: HTMLElement[] = [h("h1", { class: "hero-title", id: "play-title" }, title)];
  if (text) out.push(h("p", { class: "hero-text" }, text));
  return out;
}

// Same rule as the Settings page: no switching servers while a task or the game runs.
function leaveLink(snap: Snapshot): HTMLButtonElement {
  return linkButton(t("connect_use_other"), () => showModal({ kind: "leave" }), { fk: "leave", disabled: snap.busy || snap.task !== null || snap.game.running });
}

// Servers joined before: one click to go back to one, no invite to paste. The current one is left out.
async function switchTo(id: string): Promise<void> {
  const r = await api.switchServer(id);
  if (!r.ok && r.error && r.error.code !== "cancelled") {
    if (!(await api.getSnapshot()).lastError) state.localError = r.error;
    renderBanners();
    return;
  }
  setView("play");
}

function savedServerSub(sv: Snapshot["savedServers"][number]): HTMLElement {
  const address = blurred(`${sv.host}:${sv.port}`);
  return sv.username ? h("span", {}, `${t("saved_account", { name: sv.username })} · `, address) : h("span", {}, address);
}

function savedServersCard(snap: Snapshot): HTMLElement | null {
  const others = snap.savedServers.filter((sv) => !sv.current);
  if (others.length === 0) return null;
  const locked = snap.busy || snap.task !== null || snap.game.running;
  const rows = others.map((sv) =>
    h(
      "div",
      { class: "settings-row" },
      h(
        "div",
        { class: "settings-row-text" },
        h("span", { class: "settings-row-title" }, sv.name, " ", modeBadge(sv.mode)),
        h("span", { class: "settings-row-sub mono" }, savedServerSub(sv)),
      ),
      h(
        "div",
        { class: "settings-actions" },
        button(t("saved_join"), () => void switchTo(sv.id), { cls: "btn-primary", fk: `saved-${sv.id}`, disabled: locked }),
        linkButton(t("saved_remove"), () => showModal({ kind: "remove_server", id: sv.id, name: sv.name }), { icon: "close", fk: `saved-rm-${sv.id}`, disabled: locked }),
      ),
    ),
  );
  return card("", h("h2", { class: "card-title" }, t("saved_title")), h("p", { class: "card-text" }, t("saved_text")), ...rows);
}

function playJoin(snap: Snapshot): HTMLElement[] {
  const saved = savedServersCard(snap);
  return [
    h("div", { class: "eyebrow" }, t("join_eyebrow")),
    ...heading(t("join_title"), t("join_text")),
    ...(saved ? [saved] : []),
    card(
      "",
      h("div", { class: "field" }, h("label", { class: "field-label", for: "invite-input" }, t("join_label")), inviteInput, invitePreview, inviteHint),
      h("p", { class: "small-print" }, t("join_next")),
    ),
  ];
}

function playConnect(snap: Snapshot): HTMLElement[] {
  const sv = snap.server!;
  const name = serverName();
  const pub = sv.mode === "public";
  const lastChecked = snap.connect.lastCheckedAt ? t("connect_last_checked", { time: new Date(snap.connect.lastCheckedAt).toLocaleTimeString(TIME_LOCALES[state.lang]) }) : null;
  const foot = h("div", { class: "card-row" }, lastChecked ? h("span", { class: "hint" }, lastChecked) : null, leaveLink(snap));
  if (snap.connect.checking || (snap.connect.problem === null && snap.connect.lastCheckedAt === null)) {
    return [eyebrow(snap), ...heading(t("connect_checking_title", { name }), t(pub ? "connect_checking_text_public" : "connect_checking_text")), card("", h("div", { class: "card-row" }, h("div", { class: "spinner", role: "presentation" }), t("connect_checking_wait")))];
  }
  switch (snap.connect.problem) {
    case "tailscale_missing":
      return [
        eyebrow(snap),
        ...heading(t("connect_ts_title"), t("connect_ts_text", { name })),
        card(
          "",
          h(
            "ol",
            { class: "steps-list" },
            h("li", {}, h("div", {}, h("div", {}, t("connect_step_install")), linkButton(t("connect_btn_install_ts"), () => open("tailscale_download"), { icon: "external", fk: "ts-dl" }))),
            h(
              "li",
              {},
              h("div", {}, h("div", {}, t(sv.hasShare ? "connect_step_accept" : "connect_step_accept_nolink")), sv.hasShare ? linkButton(t("connect_btn_accept"), () => open("tailscale_share"), { icon: "external", fk: "ts-share" }) : null),
            ),
            h("li", {}, t("connect_step_retry")),
          ),
        ),
        foot,
      ];
    case "cert_mismatch":
      return [
        eyebrow(snap),
        ...heading(t("connect_cert_title"), null),
        card(
          "card-danger",
          h("h3", { class: "card-title" }, icon("shield"), t("connect_cert_subtitle")),
          h("p", { class: "card-text" }, t("connect_cert_text", { host: hideText(sv.host) })),
          h("p", { class: "card-text" }, t("connect_cert_next")),
        ),
        foot,
      ];
    case "bad_answer":
      return [eyebrow(snap), ...heading(t("connect_bad_title"), t("connect_bad_text", { host: hideText(sv.host), port: sv.port })), foot];
    default:
      return [
        eyebrow(snap),
        ...heading(t("connect_unreach_title", { name }), t(pub ? "connect_unreach_text_public" : "connect_unreach_text", { host: hideText(sv.host) })),
        card(
          "",
          h(
            "ul",
            { class: "check-list" },
            ...(pub
              ? [h("li", {}, t("connect_check_internet")), h("li", {}, t("connect_check_server")), h("li", {}, t("connect_check_firewall"))]
              : [h("li", {}, t("connect_check_ts_on")), h("li", {}, t("connect_check_share")), h("li", {}, t("connect_check_server"))]),
          ),
        ),
        foot,
      ];
  }
}

async function useKey(): Promise<void> {
  const key = extractAccountKey(keyInput.value);
  if (!key) {
    state.localError = { code: "key_invalid" };
    renderBanners();
    return;
  }
  const r = await api.useExistingKey(key);
  if (r.ok) {
    keyInput.value = "";
    state.keyFormOpen = false;
    state.localError = null;
  } else if (!state.snap?.lastError) {
    state.localError = r.error;
  }
  renderAll();
}

async function useExistingPath(): Promise<void> {
  if (!existingGameInput.value.trim()) {
    existingGameInput.focus();
    return;
  }
  const r = await api.useExistingGamePath(existingGameInput.value);
  if (r.ok) {
    existingGameInput.value = "";
    state.existingFormOpen = false;
    state.localError = null;
  } else if (!state.snap?.lastError) {
    state.localError = r.error;
  }
  renderAll();
}

// The "I already have the game files" card: a link that opens a form to paste the folder or browse to it.
function existingGameCard(snap: Snapshot): HTMLElement {
  const form = state.existingFormOpen
    ? h(
        "div",
        { class: "field" },
        h("label", { class: "field-label", for: "existing-game-path" }, t("install_existing_path")),
        existingGameInput,
        h(
          "div",
          { class: "card-row" },
          button(t("install_existing_use"), () => void useExistingPath(), { cls: "btn-primary", icon: "check", fk: "existing-use", disabled: snap.busy }),
          button(t("install_existing_browse"), () => void api.useExistingGameFolder(), { icon: "folder", fk: "existing-browse", disabled: snap.busy }),
        ),
        h("p", { class: "small-print" }, t("install_existing_note")),
      )
    : null;
  return card(
    "",
    h(
      "div",
      { class: "card-row" },
      linkButton(state.existingFormOpen ? t("install_existing_hide") : t("install_existing"), () => {
        state.existingFormOpen = !state.existingFormOpen;
        renderPlay();
        if (state.existingFormOpen) existingGameInput.focus();
      }, { icon: "folder", fk: "existing", disabled: snap.busy }),
      h("span", { class: "hint" }, t("install_existing_text")),
    ),
    form,
  );
}

function playRegister(snap: Snapshot): HTMLElement[] {
  const name = serverName();
  const out: HTMLElement[] = [eyebrow(snap), ...heading(t("reg_title"), t("reg_text", { name }))];
  if (snap.lastError?.code === "key_rejected") {
    out.push(card("card-warn", h("h3", { class: "card-title" }, icon("key"), t("reg_rejected_title")), h("p", { class: "card-text" }, t("reg_rejected", { name }))));
  }
  if (snap.status?.registration === "NONE") {
    out.push(card("card-warn", h("h3", { class: "card-title" }, icon("warning"), t("reg_closed_title")), h("p", { class: "card-text" }, t("reg_closed"))));
  }
  const keyForm = state.keyFormOpen
    ? h(
        "div",
        { class: "field" },
        h("label", { class: "field-label", for: "key-input" }, t("reg_key_label")),
        keyInput,
        h("div", { class: "card-row" }, button(t("reg_key_use"), () => void useKey(), { cls: "btn-primary", icon: "key", fk: "key-use", disabled: snap.busy }), button(t("reg_key_file"), () => void api.importKeyFile(), { icon: "folder", fk: "key-file", disabled: snap.busy })),
        h("p", { class: "small-print" }, t("reg_key_note")),
      )
    : null;
  out.push(
    card(
      "",
      h(
        "div",
        { class: "field" },
        h("label", { class: "field-label", for: "username-input" }, t("reg_label")),
        usernameInput,
        usernameHint,
      ),
      h(
        "p",
        { class: `small-print reg-invite${snap.server?.hasPendingInvite ? " included" : ""}` },
        icon(snap.server?.hasPendingInvite ? "check" : "info"),
        snap.server?.hasPendingInvite ? t("reg_invite_included") : t("reg_invite_missing"),
      ),
    ),
    card(
      "",
      linkButton(state.keyFormOpen ? t("reg_have_key_hide") : t("reg_have_key"), () => {
        state.keyFormOpen = !state.keyFormOpen;
        renderPlay();
        if (state.keyFormOpen) keyInput.focus();
      }, { icon: "key", fk: "key-toggle" }),
      keyForm,
    ),
  );
  return out;
}

function playInstall(snap: Snapshot): HTMLElement[] {
  const name = serverName();
  const pub = snap.server?.mode === "public";
  const low = snap.install.freeBytes !== null && snap.install.freeBytes < snap.install.requiredBytes;
  const out: HTMLElement[] = [eyebrow(snap), ...heading(t("install_title"), t(pub ? "install_text_public" : "install_text", { name }))];
  out.push(
    card(
      "",
      h(
        "div",
        { class: "stats" },
        stat(t("install_size"), formatBytes(snap.install.totalBytes, state.lang)),
        stat(t("install_free"), snap.install.freeBytes === null ? "–" : formatBytes(snap.install.freeBytes, state.lang)),
        stat(t("install_need_label"), formatBytes(snap.install.requiredBytes, state.lang)),
      ),
      h(
        "div",
        { class: "settings-row" },
        h("div", { class: "settings-row-text" }, h("span", { class: "settings-row-title" }, t("install_folder")), h("span", { class: "settings-row-sub selectable" }, secret(snap.install.dir, "install-dir"))),
        button(t("install_change"), () => void api.chooseInstallDir(), { icon: "folder", fk: "change-dir", disabled: snap.busy }),
      ),
      low ? h("div", { class: "hint hint-bad" }, icon("warning"), t("install_low_space")) : null,
    ),
  );
  if (!snap.install.contentAvailable) out.push(card("card-warn", h("h3", { class: "card-title" }, icon("warning"), t("install_no_content_title")), h("p", { class: "card-text" }, t("install_no_content"))));
  const vc = vcWarning(snap);
  if (vc) out.push(vc);
  out.push(existingGameCard(snap));
  return out;
}

function playInstalling(snap: Snapshot): HTMLElement[] {
  const kind = state.task?.kind ?? snap.task?.kind ?? "verify";
  const title = kind === "download" ? t("installing_download_title") : kind === "dlls" ? t("task_dlls") : t("installing_verify_title");
  return [eyebrow(snap), ...heading(title, t("task_note"))];
}

function playUpdate(snap: Snapshot): HTMLElement[] {
  const reason = updateReason(snap);
  const text = reason === "missing" ? t("update_missing", { n: snap.install.missingFiles }) : reason === "unverified" ? t("update_unverified") : t("update_dlls");
  const out: HTMLElement[] = [eyebrow(snap), ...heading(t("update_title"), text)];
  const vc = vcWarning(snap);
  if (vc) out.push(vc);
  out.push(existingGameCard(snap));
  return out;
}

function newsTeaser(): HTMLElement | null {
  const item = state.news[0];
  if (!item) return null;
  const c = card(
    "",
    h(
      "div",
      { class: "news-teaser" },
      item.date ? h("span", { class: "news-teaser-date" }, formatDate(item.date, state.lang)) : null,
      h("strong", {}, item.title),
      h("div", { class: "card-row" }, linkButton(t("news_read_more"), () => setView("news"), { fk: "news-more" })),
    ),
  );
  return c;
}

function playReady(snap: Snapshot): HTMLElement[] {
  const user = snap.account.username;
  const out: HTMLElement[] = [eyebrow(snap), ...heading(user ? t("ready_title", { user }) : t("ready_title_nouser"), t("ready_text"))];
  out.push(
    card(
      "",
      h(
        "div",
        { class: "card-row" },
        h("span", { class: "badge" }, icon("settings"), t("ready_graphics", { preset: t(graphicsKey(snap.settings.graphics)) })),
        h("span", { class: "badge" }, t(snap.settings.windowed ? "ready_windowed" : "ready_fullscreen")),
        linkButton(t("ready_change"), () => setView("settings"), { fk: "ready-change" }),
      ),
    ),
  );
  if (snap.account.offerBackup) {
    out.push(
      card(
        "card-accent",
        h("h3", { class: "card-title" }, t("backup_title")),
        h("p", { class: "card-text" }, t("backup_text")),
        h("div", { class: "card-row" }, button(t("backup_save"), () => void api.saveKeyBackup(), { cls: "btn-primary", icon: "key", fk: "backup-save" }), button(t("backup_later"), () => void api.dismissBackupOffer(), { fk: "backup-later" })),
      ),
    );
  }
  const vc = vcWarning(snap);
  if (vc) out.push(vc);
  const teaser = newsTeaser();
  if (teaser && !snap.account.offerBackup) out.push(teaser);
  return out;
}

function playRunning(snap: Snapshot): HTMLElement[] {
  const out: HTMLElement[] = [eyebrow(snap), ...heading(t("running_title"), t("running_text"))];
  if (snap.server?.mode === "public") {
    out.push(card("card-accent", h("h3", { class: "card-title" }, t("running_public_title")), h("p", { class: "card-text" }, t("running_public_text"))));
  }
  return out;
}

function renderPlay(): void {
  const snap = state.snap;
  const container = $("#view-play");
  if (!snap) {
    renderRegion(container, "loading", () => [h("div", { class: "play-content" }, h("div", { class: "card-row" }, h("div", { class: "spinner" }), t("loading")))]);
    return;
  }
  const sig = JSON.stringify([
    state.lang,
    snap.phase,
    snap.busy,
    snap.server,
    snap.connect,
    snap.account,
    snap.install,
    snap.settings,
    snap.status?.registration ?? null,
    snap.status?.name ?? null,
    snap.lastError?.code === "key_rejected",
    state.keyFormOpen,
    state.existingFormOpen,
    state.news[0]?.title ?? null,
    snap.phase === "installing" ? state.task?.kind ?? snap.task?.kind : null,
  ]);
  renderRegion(container, sig, () => {
    let parts: HTMLElement[];
    switch (snap.phase) {
      case "loading":
        parts = [h("div", { class: "card-row" }, h("div", { class: "spinner" }), t("loading"))];
        break;
      case "join":
        parts = playJoin(snap);
        break;
      case "connect":
        parts = playConnect(snap);
        break;
      case "register":
        parts = playRegister(snap);
        break;
      case "install":
        parts = playInstall(snap);
        break;
      case "installing":
        parts = playInstalling(snap);
        break;
      case "update":
        parts = playUpdate(snap);
        break;
      case "ready":
        parts = playReady(snap);
        break;
      case "running":
        parts = playRunning(snap);
        break;
    }
    return [h("div", { class: "play-content" }, ...parts, partnerBanner())];
  });
}

// ------------------------------------------------------------------ action bar

const progressEls = (() => {
  const title = h("span", { class: "progress-title" });
  const percent = h("span", { class: "progress-percent" });
  const fill = h("div", { class: "bar-fill" });
  const bar = h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 }, fill);
  const meta = h("div", { class: "progress-meta" });
  const file = h("div", { class: "progress-file" });
  const cancel = linkButton("", () => void api.cancelTask(), { fk: "task-cancel" });
  // Not a live region: the numbers change four times a second. The progressbar role gives the
  // value on request, and #action-live announces the milestones.
  const root = h("div", { class: "progress", "aria-live": "off" }, h("div", { class: "progress-head" }, title, percent, cancel), bar, meta, file);
  return { root, title, percent, fill, bar, meta, file, cancel };
})();

function renderProgress(task: TaskProgress): void {
  const v = taskView(task, state.lang);
  const p = progressEls;
  p.title.textContent = t(v.titleKey);
  p.percent.textContent = v.indeterminate ? "" : `${v.percent.toFixed(v.percent < 10 ? 1 : 0).replace(".", state.lang === "en" ? "." : ",")} %`;
  p.fill.style.width = `${v.indeterminate ? 35 : v.percent}%`;
  p.bar.classList.toggle("paused", task.paused);
  p.bar.classList.toggle("indeterminate", v.indeterminate);
  p.bar.setAttribute("aria-valuenow", String(Math.round(v.percent)));
  p.bar.setAttribute("aria-label", t(v.titleKey));
  const bits: (string | null)[] = [
    v.bytesText,
    v.speedText,
    v.etaText ? t("task_eta", { time: v.etaText }) : null,
    t("task_files", { done: task.filesDone, total: task.filesTotal }),
  ];
  const current = shortFile(task.currentFile);
  const meta: Node[] = [];
  for (const b of bits) if (b) meta.push(h("span", {}, b));
  p.meta.replaceChildren(...meta);
  p.file.textContent = current && task.kind !== "dlls" ? t("task_current", { file: current }) : "";
  p.cancel.textContent = t("task_cancel");
}

function renderSteps(snap: Snapshot): HTMLElement {
  const current = stepIndex(snap.phase);
  const keys: StringKey[] = ["step_join", "step_register", "step_install", "step_play"];
  const items: HTMLElement[] = [];
  keys.forEach((k, i) => {
    const cls = i < current || snap.phase === "running" ? "done" : i === current ? "current" : "";
    if (i > 0) items.push(h("li", { class: `step-line ${i <= current ? "done" : ""}`, "aria-hidden": "true" }));
    items.push(
      h(
        "li",
        { class: `step ${cls}`, "aria-current": i === current ? "step" : undefined },
        h("span", { class: "step-dot" }, cls === "done" ? icon("check") : String(i + 1)),
        h("span", { class: "step-label" }, t(k)),
      ),
    );
  });
  return h("ol", { class: "steps", "aria-label": t("steps_label") }, ...items);
}

function actionHint(snap: Snapshot): string {
  switch (snap.phase) {
    case "join":
      return t("hint_join");
    case "connect":
      return snap.connect.checking ? t("hint_connecting") : snap.connect.problem === "cert_mismatch" ? t("hint_cert") : t("hint_connect");
    case "register":
      return t("hint_register");
    case "install":
      return t("hint_install", { size: formatBytes(snap.install.totalBytes, state.lang) });
    case "update":
      return t("hint_update");
    case "ready":
      return t("hint_ready");
    case "running":
      return t("hint_running");
    default:
      return "";
  }
}

const primary = $("#primary") as HTMLButtonElement;

function renderActionBar(): void {
  const snap = state.snap;
  const info = $("#action-info");
  if (!snap) {
    primary.disabled = true;
    primary.textContent = t("btn_wait");
    return;
  }
  const b = primaryButton(snap, formState());
  primary.textContent = t(b.labelKey);
  primary.disabled = b.disabled;
  primary.classList.toggle("is-running", b.action === "none" && snap.phase === "running");
  primary.classList.toggle("is-pause", b.action === "pause" || b.action === "resume");
  primary.classList.toggle("is-ready", b.action === "play" && !b.disabled && !reducedMotion.matches);
  primary.setAttribute("data-action", b.action);

  const task = snap.phase === "installing" ? state.task ?? snap.task : null;
  if (task) {
    if (!info.contains(progressEls.root)) info.replaceChildren(progressEls.root);
    renderProgress(task);
    forceRender(info);
    const v = taskView(task, state.lang);
    announce(v.indeterminate ? t(v.titleKey) : `${t(v.titleKey)}: ${Math.floor(v.percent / 10) * 10} %`);
  } else {
    renderRegion(info, JSON.stringify([state.lang, snap.phase, snap.connect.checking, snap.connect.problem, snap.install.totalBytes]), () => [renderSteps(snap), h("div", { class: "action-hint" }, actionHint(snap))]);
    announce(actionHint(snap));
  }
}

// The action bar's screen reader announcements: what to do next, and download milestones (every
// 10 %). Nothing else in the bar is a live region.
function announce(text: string): void {
  const live = $("#action-live");
  if (live.textContent !== text) live.textContent = text;
}

async function onPrimary(): Promise<void> {
  const snap = state.snap;
  if (!snap) return;
  const b = primaryButton(snap, formState());
  if (b.disabled || b.action === "none") return;
  state.localError = null;
  let result: { ok: boolean; error?: LauncherError } | undefined;
  switch (b.action) {
    case "join": {
      const text = state.inviteText.trim();
      // A changed certificate gets the warning first, never a direct join.
      const m = await inviteModal(text);
      if (m?.kind === "cert_changed") {
        showModal(m);
        return;
      }
      result = await api.submitInvite(text);
      if (result.ok) clearInviteInput();
      else if (result.error?.code === "cert_changed") {
        const again = await inviteModal(text);
        if (again) showModal(again);
        return;
      }
      break;
    }
    case "retry":
      result = await api.retryConnect();
      break;
    case "new_invite":
      showModal({ kind: "leave" });
      return;
    case "register":
      result = await api.register(state.username.trim());
      if (result.ok) {
        state.username = "";
        usernameInput.value = "";
        updateUsernameFeedback();
      }
      break;
    case "install":
    case "update":
      result = await api.startInstall();
      break;
    case "play":
      result = await api.play();
      break;
    case "pause":
      await api.pauseTask();
      break;
    case "resume":
      await api.resumeTask();
      break;
  }
  if (result && !result.ok && result.error && result.error.code !== "cancelled") {
    const latest = await api.getSnapshot();
    if (!latest.lastError) state.localError = result.error;
    onSnapshot(latest);
  }
}

primary.addEventListener("click", () => void onPrimary());

// ------------------------------------------------------------------ server panel

function instanceTitle(i: StatusInstance): string {
  switch (i.kind) {
    case "city":
      return t("inst_title_city");
    case "dojo":
      return t("inst_title_dojo");
    case "tutorial":
      return t("inst_title_tutorial");
    case "hunt":
      return t("inst_title_hunt", { behemoth: i.behemoth ?? (i.title.replace(/^Hunt:\s*/i, "") || t("kind_hunt")) });
  }
}

const KIND_ICON: Record<InstanceKind, IconName> = { city: "city", hunt: "hunt", dojo: "dojo", tutorial: "tutorial" };

function instanceCard(i: StatusInstance): HTMLElement {
  const pct = i.maxPlayers > 0 ? Math.min(100, (i.players / i.maxPlayers) * 100) : 0;
  const fill = h("span", {});
  fill.style.width = `${pct}%`;
  return h(
    "div",
    { class: `instance k-${i.kind}` },
    h("div", { class: "instance-icon" }, icon(KIND_ICON[i.kind])),
    h("div", { class: "instance-title", title: instanceTitle(i) }, instanceTitle(i)),
    h(
      "div",
      { class: "instance-meta" },
      h("span", {}, i.maxPlayers > 0 ? t("inst_players", { n: i.players, max: i.maxPlayers }) : t("inst_players_nomax", { n: i.players })),
      h("span", {}, t("inst_running", { time: formatRunningTime(i.startedAt, Date.now(), state.lang) })),
    ),
    h("div", { class: "instance-bar", "aria-hidden": "true" }, fill),
  );
}

function playerList(status: ServerStatus, max: number): HTMLElement {
  const byId = new Map(status.instances.map((i) => [i.id, i]));
  const shown = status.players.slice(0, max);
  const items = shown.map((p) => {
    const inst = p.instance ? byId.get(p.instance) : undefined;
    const where = inst && inst.kind === "hunt" ? `${t(whereKey(p.where))} · ${inst.behemoth ?? instanceTitle(inst)}` : t(whereKey(p.where));
    return h(
      "li",
      { class: `player w-${p.where}` },
      h("span", { class: "player-avatar", "aria-hidden": "true" }, Array.from(p.name)[0]?.toUpperCase() ?? "?"),
      h("span", { class: "player-text" }, h("span", { class: `player-name${streamer() ? " secret-blur" : ""}` }, streamer() ? filler(p.name) : p.name), h("span", { class: "player-where" }, where)),
    );
  });
  const list = h("ul", { class: "players" }, ...items);
  if (status.players.length > max) list.appendChild(h("li", { class: "player-where", style: undefined }, t("sp_more", { n: status.players.length - max })));
  return list;
}

function renderPanel(): void {
  const panel = $("#server-panel");
  const snap = state.snap;
  const minute = Math.floor(Date.now() / 30000);
  const sig = JSON.stringify([state.lang, snap?.server ?? null, snap?.status ?? null, snap?.statusUnsupported, snap?.phase === "connect", snap?.connect.problem, snap?.connect.checking, minute]);
  renderRegion(panel, sig, () => {
    if (!snap || !snap.server) {
      return [
        h("div", { class: "sp-head" }, h("span", { class: "sp-kicker" }, t("sp_title")), h("span", { class: "sp-name" }, t("rail_not_joined"))),
        h("p", { class: "sp-empty" }, t("sp_nojoin")),
        panelFoot(null),
      ];
    }
    const status = snap.status;
    const reachable = snap.phase !== "connect";
    const online = reachable && (status ? status.online : true);
    const head = h(
      "div",
      { class: "sp-head" },
      h("span", { class: "sp-kicker" }, t("sp_title")),
      h("span", { class: "sp-name" }, serverName()),
      h("div", { class: "sp-state" }, h("span", { class: `dot ${online ? "online" : "offline"}`, "aria-hidden": "true" }), online ? t("sp_online") : t("sp_offline"), modeBadge(snap.server.mode)),
    );
    // Not reachable, or refused for its certificate: say so instead of "waiting", and do not show
    // an old player list as if it were live.
    if (snap.phase === "connect" && !snap.connect.checking && snap.connect.problem) {
      const text = snap.connect.problem === "cert_mismatch" ? t("connect_cert_subtitle") : t("sp_no_answer");
      return [head, h("p", { class: `sp-empty${snap.connect.problem === "cert_mismatch" ? " sp-problem" : ""}` }, text), panelFoot(null)];
    }
    if (!status) {
      return [head, h("p", { class: "sp-empty" }, reachable && snap.statusUnsupported ? t("sp_unsupported") : t("sp_waiting")), panelFoot(null)];
    }
    // The server shows who is online to registered players only: say so instead of an empty list
    // (and no "0 players", no "no worlds running", which would not be true).
    if (status.limited) {
      return [
        head,
        h("div", { class: "sp-section" }, h("div", { class: "sp-section-title" }, t("server_players"), icon("people")), h("p", { class: "sp-empty" }, t("sp_signin"))),
        panelFoot(status),
      ];
    }
    const instances = sortInstances(status.instances);
    return [
      head,
      h(
        "div",
        { class: "sp-section" },
        h("div", { class: "sp-section-title" }, t("server_players"), icon("people")),
        h("div", { class: "sp-count" }, h("span", { class: "sp-count-num" }, String(status.playersOnline)), h("span", { class: "sp-count-label" }, t(status.playersOnline === 1 ? "sp_players_one_label" : "sp_players_other_label"))),
        status.players.length > 0 ? playerList(status, 8) : h("p", { class: "sp-empty" }, t("sp_nobody")),
      ),
      h(
        "div",
        { class: "sp-section" },
        h("div", { class: "sp-section-title" }, t("sp_worlds")),
        instances.length > 0 ? h("div", { class: "instances" }, ...instances.slice(0, 6).map(instanceCard)) : h("p", { class: "sp-empty" }, t("sp_no_worlds")),
        instances.length > 6 ? linkButton(t("sp_all_worlds", { n: instances.length }), () => setView("server"), { fk: "all-worlds" }) : null,
      ),
      panelFoot(status),
    ];
  });
}

function panelFoot(status: ServerStatus | null): HTMLElement {
  return h(
    "div",
    { class: "sp-foot" },
    status
      ? h(
          "div",
          { class: "sp-foot-row" },
          h("span", {}, t("sp_version", { version: [status.version, status.commit].filter(Boolean).join(" · ") || "–" })),
          linkButton(t("sp_source"), () => open("server_source"), { icon: "external", fk: "sp-source" }),
        )
      : null,
    h(
      "div",
      { class: "sp-foot-row" },
      h("span", {}, t("about_version", { v: state.snap?.app.version ?? "" })),
      linkButton(t("about_source"), () => open("project_source"), { icon: "external", fk: "sp-launcher-source" }),
    ),
  );
}

// ------------------------------------------------------------------ news page

function renderNews(): void {
  const container = $("#view-news");
  const snap = state.snap;
  const sig = JSON.stringify([state.lang, state.news, snap?.server?.name ?? null, snap?.status?.name ?? null]);
  renderRegion(container, sig, () => {
    const title = snap?.server ? t("news_title", { name: serverName() }) : t("news_title_generic");
    const body: HTMLElement[] = [];
    if (!snap?.server) body.push(card("", h("p", { class: "card-text" }, t("news_offline"))));
    else if (state.news.length === 0) body.push(card("", h("p", { class: "card-text" }, t("news_empty"))));
    else {
      for (const n of state.news) {
        body.push(
          h(
            "article",
            { class: "card news-item" },
            n.date ? h("time", { class: "news-date", datetime: n.date }, formatDate(n.date, state.lang)) : null,
            h("h2", { class: "news-title" }, n.title),
            h("p", { class: "news-body" }, n.body),
          ),
        );
      }
    }
    return [h("div", { class: "page" }, h("h1", { class: "page-title", id: "news-title" }, title), ...body, partnerBanner())];
  });
}

// ------------------------------------------------------------------ partners page

function partnerBanner(): HTMLElement {
  const banner = h(
    "button",
    { type: "button", class: "partner-banner", "data-fk": "partner-banner", "aria-label": t("partner_banner_label") },
    h("img", { src: partnerLogo, alt: "EU Gamehost", draggable: "false" }),
    h("span", { class: "partner-banner-copy" },
      h("span", { class: "partner-mini-label" }, t("partner_ad")),
      h("strong", {}, t("partner_banner_title")),
      h("span", { class: "partner-banner-cta" }, t("partner_banner_cta")),
    ),
  );
  banner.addEventListener("click", () => setView("partners"));
  return banner;
}

function partnerHostingCard(): HTMLElement {
  const plans: readonly { name: string; price: string; spec: string; target: ExternalTarget; note: StringKey }[] = [
    { name: "VDS GAME 1", price: "£24.99", spec: "1 vCPU · 4 GB RAM · 60 GB NVMe", target: "eugamehost_game1", note: "partner_small" },
    { name: "VDS GAME 3", price: "£44.99", spec: "3 vCPU · 12 GB RAM · 180 GB NVMe", target: "eugamehost_game3", note: "partner_recommended" },
    { name: "VDS GAME 5", price: "£66.99", spec: "6 vCPU · 24 GB RAM · 360 GB NVMe", target: "eugamehost_game5", note: "partner_headroom" },
    { name: "Ryzen 7 5800X", price: "£85", spec: "8c/16t · 32 GB DDR4 · 1 TB NVMe", target: "eugamehost_5800x", note: "partner_dedicated" },
  ];
  const grid = h("div", { class: "partner-plans" });
  for (const p of plans) {
    const b = h(
      "button",
      { type: "button", class: `partner-plan${p.note === "partner_recommended" ? " recommended" : ""}`, "data-fk": p.target },
      h("span", { class: "partner-plan-note" }, t(p.note)),
      h("strong", {}, p.name),
      h("span", { class: "partner-price" }, p.price, h("span", {}, t("partner_per_month"))),
      h("span", { class: "partner-spec" }, p.spec),
      h("span", { class: "partner-spec" }, t(p.target === "eugamehost_5800x" ? "partner_network_dedicated" : "partner_network_vds")),
      h("span", { class: "partner-cta" }, t("partner_plan_cta"), icon("external")),
    );
    b.addEventListener("click", () => open(p.target));
    grid.append(b);
  }
  return card(
    "partner-card",
    h("div", { class: "partner-head" },
      h("img", { class: "partner-logo", src: partnerLogo, alt: "EU Gamehost", draggable: "false" }),
      h("div", {},
        h("span", { class: "badge partner-badge" }, t("partner_ad")),
        h("h2", { class: "partner-title" }, t("partner_title")),
      ),
    ),
    h("p", { class: "card-text partner-copy" }, t("partner_intro")),
    grid,
    h("div", { class: "card-row partner-actions" },
      linkButton(t("partner_explore"), () => open("eugamehost"), { icon: "external", fk: "host-all" }),
    ),
    h("p", { class: "small-print partner-disclosure" }, t("partner_disclosure")),
  );
}

function renderPartners(): void {
  renderRegion($("#view-partners"), state.lang, () => [
    h("div", { class: "page partners-page" },
      h("h1", { class: "page-title", id: "partners-title" }, t("nav_partners")),
      h("p", { class: "page-sub" }, t("partners_subtitle")),
      partnerHostingCard(),
      card("",
        h("h2", { class: "card-title" }, icon("server"), t("partner_capacity_title")),
        h("p", { class: "card-text" }, t("partner_capacity")),
        h("p", { class: "small-print" }, t("partner_capacity_note")),
      ),
    ),
  ]);
}

// ------------------------------------------------------------------ mods page

// The optional client mods (client-mods/ in the repository, by ZFXSTATIC): what each one does.
// Information only; the launcher installs them and the in-game Mod Menu switches them.
const MODS: readonly { icon: IconName; name: StringKey; text: StringKey; use: StringKey }[] = [
  { icon: "puzzle", name: "mod_cst_name", text: "mod_cst_text", use: "mod_cst_use" },
  { icon: "heart", name: "mod_bhb_name", text: "mod_bhb_text", use: "mod_bhb_use" },
  { icon: "hunt", name: "mod_trk_name", text: "mod_trk_text", use: "mod_trk_use" },
  { icon: "settings", name: "mod_menu_name", text: "mod_menu_text", use: "mod_menu_use" },
];

function renderMods(): void {
  renderRegion($("#view-mods"), state.lang, () => [
    h("div", { class: "page mods-page" },
      h("h1", { class: "page-title", id: "mods-title" }, t("nav_mods")),
      h("p", { class: "page-sub" }, t("mods_subtitle")),
      card(
        "mods-author",
        h("span", { class: "badge mods-badge" }, t("mods_badge")),
        h("h2", { class: "mods-title" }, t("mods_title")),
        h("p", { class: "card-text mods-intro" }, t("mods_intro")),
        h("div", { class: "mods-grid" },
          ...MODS.map((m) =>
            h("div", { class: "mod-card" },
              h("span", { class: "mod-by" }, t("mods_by")),
              h("strong", { class: "mod-name" }, icon(m.icon), t(m.name)),
              h("span", { class: "mod-text" }, t(m.text)),
              h("span", { class: "mod-use" }, t(m.use)),
            ),
          ),
        ),
      ),
      card("",
        h("h2", { class: "card-title" }, icon("info"), t("mods_notes_title")),
        h("p", { class: "card-text" }, t("mods_note_local")),
        h("p", { class: "card-text" }, t("mods_note_settings")),
        h("p", { class: "small-print" }, t("mods_note_windows")),
      ),
      h("p", { class: "small-print mods-credit" }, t("mods_credit")),
    ),
  ]);
}

// ------------------------------------------------------------------ server page

function renderServer(): void {
  const container = $("#view-server");
  const snap = state.snap;
  const minute = Math.floor(Date.now() / 30000);
  const sig = JSON.stringify([state.lang, snap?.server ?? null, snap?.savedServers ?? [], snap?.status ?? null, snap?.phase, snap?.connect.problem, snap?.busy, !!snap?.task, snap?.game.running, minute]);
  renderRegion(container, sig, () => {
    if (!snap?.server) {
      return [h("div", { class: "page" }, h("h1", { class: "page-title", id: "server-title" }, t("nav_server")), card("", h("p", { class: "card-text" }, t("sp_nojoin"))), partnerBanner())];
    }
    const sv = snap.server;
    const status = snap.status;
    const rows: [string, Node | string][] = [
      [t("server_address"), secret(`${sv.host}:${sv.port}`, "server-address", "mono")],
      [t("server_connection"), sv.mode === "public" ? t("server_connection_public") : t("server_connection_private")],
    ];
    if (sv.fingerprint) rows.push([t("server_fingerprint"), secret(groupedFingerprint(sv.fingerprint), "server-fp", "fingerprint")]);
    if (status) {
      rows.push([t("server_registration"), status.registration ? tk(`reg_mode_${status.registration}`) : "–"]);
      rows.push([t("server_version"), [status.version, status.commit].filter(Boolean).join(" · ") || "–"]);
      rows.push([t("server_uptime"), formatDuration(status.uptimeSeconds, state.lang)]);
    }
    const kv = h("dl", { class: "kv" });
    for (const [k, v] of rows) kv.append(h("dt", {}, k), h("dd", {}, v));
    const parts: HTMLElement[] = [
      h("h1", { class: "page-title", id: "server-title" }, serverName()),
      h("p", { class: "page-sub" }, t("server_auto")),
      partnerBanner(),
      card("", kv, h("div", { class: "card-row", style: undefined }, button(t("sp_refresh"), () => void api.refreshStatus(), { icon: "refresh", fk: "srv-refresh" }), status?.sourceUrl ? linkButton(t("sp_source"), () => open("server_source"), { icon: "external", fk: "srv-source" }) : null)),
    ];
    if (status?.limited) {
      parts.push(card("", h("h2", { class: "card-title" }, t("server_players")), h("p", { class: "card-text" }, t("sp_signin"))));
    } else if (status) {
      const instances = sortInstances(status.instances);
      parts.push(
        h(
          "div",
          { class: "grid-2" },
          card("", h("h2", { class: "card-title" }, t("server_players_count", { n: status.playersOnline })), status.players.length ? playerList(status, 100) : h("p", { class: "card-text" }, t("sp_nobody"))),
          card("", h("h2", { class: "card-title" }, t("server_worlds")), instances.length ? h("div", { class: "instances" }, ...instances.map(instanceCard)) : h("p", { class: "card-text" }, t("sp_no_worlds"))),
        ),
      );
    }
    const saved = savedServersCard(snap);
    if (saved) parts.push(saved);
    parts.push(h("div", { class: "card-row" }, leaveLink(snap)));
    return [h("div", { class: "page" }, ...parts)];
  });
}

// ------------------------------------------------------------------ settings page

function settingsRow(title: string, sub: string | Node | null, ...actions: (HTMLElement | null)[]): HTMLElement {
  return h(
    "div",
    { class: "settings-row" },
    h("div", { class: "settings-row-text" }, h("span", { class: "settings-row-title" }, title), sub ? h("span", { class: "settings-row-sub" }, sub) : null),
    h("div", { class: "settings-actions" }, ...actions),
  );
}

interface DropdownOption<T> {
  value: T;
  label: string;
  lang?: string;
}

// A select in the launcher's own style: the native <select> opens a list drawn by Windows. A button
// (the closed look of .select, so <label for> still points at it) and a listbox, with the keys a
// select has: Up/Down/Home/End move, Enter/Space choose, Escape and Tab close, typing a letter jumps.
function dropdown<T extends string | number>(opts: { id: string; fk: string; value: T; options: DropdownOption<T>[]; onChange: (v: T) => void; disabled?: boolean }): HTMLElement {
  const current = opts.options.find((o) => o.value === opts.value) ?? opts.options[0];
  const listId = `${opts.id}-list`;
  const btn = h("button", { type: "button", class: "select dropdown-button", id: opts.id, "data-fk": opts.fk, "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": listId, disabled: opts.disabled }, current.label);
  if (current.lang) btn.setAttribute("lang", current.lang);
  const list = h("ul", { class: "dropdown-list", id: listId, role: "listbox", tabindex: "-1", hidden: true });
  const items = opts.options.map((o, i) => {
    const li = h("li", { class: "dropdown-option", role: "option", id: `${opts.id}-opt-${i}`, "aria-selected": o.value === current.value ? "true" : "false", lang: o.lang }, o.label);
    li.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus on the list
    li.addEventListener("click", () => choose(i));
    li.addEventListener("mousemove", () => highlight(i));
    list.appendChild(li);
    return li;
  });
  const wrap = h("div", { class: "dropdown" }, btn, list);
  let active = Math.max(0, opts.options.indexOf(current));

  function highlight(i: number): void {
    active = (i + items.length) % items.length;
    items.forEach((li, j) => li.classList.toggle("active", j === active));
    list.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  }
  function onOutside(e: MouseEvent): void {
    if (!wrap.contains(e.target as Node)) close(false);
  }
  function open(): void {
    if (opts.disabled || !list.hidden) return;
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    // Open upwards when there is no room below (the language card sits at the bottom of the page).
    const below = window.innerHeight - btn.getBoundingClientRect().bottom;
    wrap.classList.toggle("dropdown-up", below < list.offsetHeight + 12);
    highlight(Math.max(0, opts.options.indexOf(current)));
    list.focus();
    document.addEventListener("mousedown", onOutside, true);
  }
  function close(refocus: boolean): void {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutside, true);
    if (refocus) btn.focus();
  }
  function choose(i: number): void {
    close(true);
    const o = opts.options[i];
    if (o && o.value !== current.value) opts.onChange(o.value);
  }

  btn.addEventListener("click", () => (list.hidden ? open() : close(true)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener("keydown", (e) => {
    const moves: Record<string, () => number> = { ArrowDown: () => active + 1, ArrowUp: () => active - 1, Home: () => 0, End: () => items.length - 1 };
    if (moves[e.key]) {
      e.preventDefault();
      highlight(moves[e.key]());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault(); // so Escape closes the list, not the page behind it
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const next = opts.options.findIndex((o, j) => j > active && o.label.toLowerCase().startsWith(k));
      const first = opts.options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (next >= 0 || first >= 0) highlight(next >= 0 ? next : first);
    }
  });
  // Focus leaving the list closes it; a click on the button closes it through the button instead.
  list.addEventListener("blur", (e) => {
    if (e.relatedTarget !== btn) close(false);
  });
  return wrap;
}

function renderSettings(): void {
  const container = $("#view-settings");
  const snap = state.snap;
  if (!snap) return;
  const sig = JSON.stringify([state.lang, snap.settings, snap.install.dir, snap.account, snap.server, snap.savedServers, snap.app, snap.phase, snap.busy, !!snap.task]);
  renderRegion(container, sig, () => {
    const busy = snap.busy || snap.task !== null || snap.game.running;

    const select = dropdown<GraphicsPreset>({
      id: "gfx-select",
      fk: "gfx",
      value: snap.settings.graphics,
      options: GRAPHICS_PRESETS.map((g) => ({ value: g, label: t(graphicsKey(g)) })),
      onChange: (graphics) => void api.setSettings({ graphics }),
    });

    // Auto exposure (roadmap 4.17): "game" by default; "basic" is the opt-in experiment for the airship.
    const exposure = dropdown<ExposureMode>({
      id: "exposure-select",
      fk: "exposure",
      value: snap.settings.exposure,
      options: EXPOSURE_MODES.map((m) => ({ value: m, label: t(exposureKey(m)) })),
      onChange: (exposure) => void api.setSettings({ exposure }),
    });

    const windowed = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": snap.settings.windowed ? "true" : "false", "aria-labelledby": "windowed-label", "data-fk": "windowed" });
    windowed.addEventListener("click", () => void api.setSettings({ windowed: !snap.settings.windowed }));

    type HuntRegion = 'auto' | 'main' | 'aus' | 'ger';
    const huntRegion = dropdown<HuntRegion>({
      id: 'hunt-region',
      fk: 'hunt-region',
      value: snap.settings.huntRegion ?? 'auto',
      options: [{ value: 'auto', label: t('region_auto') }, { value: 'main', label: t('region_main') }, { value: 'aus', label: t('region_aus') }, { value: 'ger', label: t('region_ger') }],
      onChange: (huntRegion) => void api.setSettings({ huntRegion }),
      disabled: busy,
    });

    const game = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_game")),
      h('div',{class:'settings-row'},h('div',{class:'settings-row-text'},
        h('label',{class:'settings-row-title',for:'hunt-region'},t('set_region')),
        h('span',{class:'settings-row-sub'},t('set_region_text'))),huntRegion),
      settingsRow(
        t("set_folder"),
        secret(snap.install.dir, "install-dir"),
        button(t("set_change_folder"), () => void api.chooseInstallDir(), { icon: "folder", fk: "set-dir", disabled: busy }),
        button(t("set_open_folder"), () => void api.openGameFolder(), { fk: "set-open" }),
      ),
      settingsRow(t("set_repair"), t("set_repair_text"), button(t("set_repair_button"), () => void api.repair(), { icon: "refresh", fk: "set-repair", disabled: busy || !snap.server || !snap.account.hasKey })),
    );

    const graphics = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_graphics")),
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("label", { class: "settings-row-title", for: "gfx-select" }, t("set_graphics_level")), h("span", { class: "settings-row-sub" }, t("set_graphics_text"))), select),
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("label", { class: "settings-row-title", for: "exposure-select" }, t("set_exposure")), h("span", { class: "settings-row-sub" }, t("set_exposure_text"))), exposure),
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("span", { class: "settings-row-title", id: "windowed-label" }, t("set_windowed")), h("span", { class: "settings-row-sub" }, t("set_windowed_help"))), windowed),
    );

    const langRow = h("div", { class: "lang-switch", role: "group", "aria-label": t("set_language"), style: undefined });
    for (const l of LANGUAGES) {
      const b = h("button", { type: "button", class: "lang-btn", lang: l, "aria-pressed": snap.settings.language === l ? "true" : "false", "data-fk": `set-lang-${l}` }, t(`lang_${l}`));
      b.addEventListener("click", () => void api.setSettings({ language: l }));
      langRow.appendChild(b);
    }
    // The game's own text language: every language the 1.4.4 client has text for, by its own name.
    const gameLanguage = dropdown<GameLanguage>({
      id: "game-language-select",
      fk: "game-language",
      value: snap.settings.gameLanguage,
      options: GAME_LANGUAGES.map((g) => (g === "auto" ? { value: g, label: t("game_lang_auto") } : { value: g, label: GAME_LANGUAGE_NAMES[g], lang: g })),
      onChange: (gameLanguage) => void api.setSettings({ gameLanguage }),
    });

    const language = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_language")),
      langRow,
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("label", { class: "settings-row-title", for: "game-language-select" }, t("set_game_language")), h("span", { class: "settings-row-sub" }, t("set_game_language_text"))), gameLanguage),
    );

    const account = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_account")),
      snap.server && snap.account.hasKey
        ? settingsRow(
            t("set_signed_in", { user: snap.account.username ?? "?", name: serverName() }),
            t("set_key_note"),
            button(t("set_backup"), () => void api.saveKeyBackup(), { icon: "key", fk: "set-backup" }),
            button(t("set_logout"), () => showModal({ kind: "logout" }), { cls: "btn-danger", fk: "set-logout", disabled: busy }),
          )
        : settingsRow(t("set_not_signed"), null),
      snap.server ? settingsRow(t("set_server_current"), h("span", {}, `${serverName()} (`, secret(`${snap.server.host}:${snap.server.port}`, "server-address"), ")"), button(t("set_add_server"), () => showModal({ kind: "leave" }), { fk: "set-leave", disabled: busy })) : null,
    );

    // The DLL keeps its log window hidden; players who troubleshoot can bring it back.
    const showConsole = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": snap.settings.showConsole ? "true" : "false", "aria-labelledby": "console-label", "data-fk": "show-console" });
    showConsole.addEventListener("click", () => void api.setSettings({ showConsole: !snap.settings.showConsole }));
    const troubleshooting = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_troubleshooting")),
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("span", { class: "settings-row-title", id: "console-label" }, t("set_show_console")), h("span", { class: "settings-row-sub" }, t("set_show_console_text"))), showConsole),
    );
    // Other servers joined before: switch to one, or take it off the list (its key stays on this PC).
    const otherServers = snap.savedServers.some((sv) => !sv.current)
      ? card(
          "settings-section",
          h("h2", { class: "card-title" }, t("saved_other_title")),
          h("p", { class: "card-text" }, t("saved_other_text")),
          ...snap.savedServers
            .filter((sv) => !sv.current)
            .map((sv) =>
              settingsRow(
                sv.name,
                savedServerSub(sv),
                button(t("saved_switch_to"), () => void switchTo(sv.id), { cls: "btn-primary", fk: `set-saved-${sv.id}`, disabled: busy }),
                button(t("saved_remove"), () => showModal({ kind: "remove_server", id: sv.id, name: sv.name }), { icon: "close", fk: `set-saved-rm-${sv.id}`, disabled: busy }),
              ),
            ),
        )
      : null;

    const streamerSwitch = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": streamer() ? "true" : "false", "aria-labelledby": "streamer-label", "data-fk": "streamer" });
    streamerSwitch.addEventListener("click", () => void api.setSettings({ streamerMode: !streamer() }));
    const streaming = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_streaming")),
      h("div", { class: "settings-row" }, h("div", { class: "settings-row-text" }, h("span", { class: "settings-row-title", id: "streamer-label" }, t("set_streamer")), h("span", { class: "settings-row-sub" }, t("set_streamer_help"))), streamerSwitch),
    );

    const about = card(
      "settings-section",
      h("h2", { class: "card-title" }, t("set_about")),
      h("p", { class: "about-text" }, t("about_version", { v: snap.app.version })),
      h("p", { class: "about-text" }, t("about_license")),
      h(
        "div",
        { class: "card-row" },
        linkButton(t("about_source"), () => open("project_source"), { icon: "external", fk: "about-src" }),
        linkButton(t("about_license_link"), () => open("project_license"), { icon: "external", fk: "about-lic" }),
        linkButton(t("discord_link"), () => open("discord"), { icon: "external", fk: "about-discord" }),
      ),
      h("div", { class: "card-row" }, h("span", { class: "small-print" }, t("about_credits")), linkButton(t("nav_credits"), () => setView("credits"), { fk: "about-credits" })),
      h("p", { class: "small-print" }, t("about_disclaimer")),
      h("p", { class: "small-print" }, snap.app.packaged ? t("about_auto_updates") : t("about_dev_build")),
      snap.app.updateReady ? h("div", { class: "card-row" }, button(t("update_restart"), () => void api.installUpdate(), { cls: "btn-primary", fk: "about-update", disabled: snap.game.running })) : null,
    );

    return [h("div", { class: "page" }, h("h1", { class: "page-title", id: "settings-title" }, t("set_title")), game, graphics, language, account, otherServers, troubleshooting, streaming, about)];
  });
}

// ------------------------------------------------------------------ credits page

const ROLE_KEY: Record<CreditRole, StringKey> = {
  maintainer: "credits_role_maintainer",
  creator: "credits_role_creator",
  contributor: "credits_role_contributor",
};

function creditPeople(people: readonly CreditPerson[]): HTMLElement {
  return h(
    "ul",
    { class: "credit-list" },
    ...people.map((p) =>
      h(
        "li",
        { class: "credit" },
        h("span", { class: `credit-avatar role-${p.role}`, "aria-hidden": "true" }, Array.from(p.name)[0]?.toUpperCase() ?? "?"),
        h(
          "div",
          { class: "credit-text" },
          h(
            "div",
            { class: "credit-head" },
            h("span", { class: "credit-name" }, p.name),
            h("span", { class: `badge credit-role role-${p.role}` }, t(ROLE_KEY[p.role])),
            p.github !== p.name ? h("span", { class: "credit-handle" }, t("credits_github_handle", { handle: p.github })) : null,
          ),
          h("p", { class: "credit-note" }, localized(p.note, state.lang)),
        ),
      ),
    ),
  );
}

function creditPatrons(): HTMLElement {
  return h(
    "ul",
    { class: "credit-list" },
    ...PATRONS.map((p) =>
      h(
        "li",
        { class: "credit" },
        h("span", { class: "credit-avatar role-patron", "aria-hidden": "true" }, Array.from(p.name)[0]?.toUpperCase() ?? "?"),
        h(
          "div",
          { class: "credit-text" },
          h(
            "div",
            { class: "credit-head" },
            h("span", { class: "credit-name" }, p.name),
            h("span", { class: "badge credit-role role-patron" }, t("credits_role_patron")),
          ),
          h("p", { class: "credit-note" }, localized(p.note, state.lang)),
        ),
      ),
    ),
  );
}

function creditSoftware(): HTMLElement {
  return h(
    "ul",
    { class: "credit-list software-list" },
    ...SOFTWARE.map((sw) =>
      h(
        "li",
        { class: "software" },
        h(
          "div",
          { class: "credit-head" },
          h("span", { class: "credit-name" }, sw.name),
          h("span", { class: "credit-handle" }, localized(sw.author, state.lang)),
          h("span", { class: "badge software-license" }, sw.license ?? t("credits_no_license")),
        ),
        h("p", { class: "credit-note" }, localized(sw.note, state.lang)),
      ),
    ),
  );
}

function renderCredits(): void {
  const container = $("#view-credits");
  renderRegion(container, JSON.stringify([state.lang]), () => [
    h(
      "div",
      { class: "page" },
      h("h1", { class: "page-title", id: "credits-title" }, t("credits_title")),
      h("p", { class: "page-sub" }, t("credits_intro")),
      card(
        "settings-section",
        h("h2", { class: "card-title" }, "Dauntless Revived"),
        h("p", { class: "card-text" }, t("credits_project_text")),
        creditPeople(PROJECT_PEOPLE),
        h("div", { class: "card-row" }, linkButton(t("credits_all_contributors"), () => open("project_contributors"), { icon: "external", fk: "cr-contributors" })),
      ),
      card(
        "settings-section",
        h("h2", { class: "card-title" }, t("credits_patrons_title")),
        h("p", { class: "card-text" }, t("credits_patrons_text")),
        creditPatrons(),
      ),
      card(
        "settings-section",
        h("h2", { class: "card-title" }, "Undaunted"),
        h("p", { class: "card-text" }, t("credits_upstream_text")),
        creditPeople(UPSTREAM_PEOPLE),
        h(
          "div",
          { class: "card-row" },
          linkButton(t("credits_upstream_source"), () => open("upstream_source"), { icon: "external", fk: "cr-upstream" }),
          linkButton(t("credits_upstream_contributors"), () => open("upstream_contributors"), { icon: "external", fk: "cr-upstream-contributors" }),
        ),
      ),
      card("settings-section", h("h2", { class: "card-title" }, t("credits_software")), h("p", { class: "card-text" }, t("credits_software_text")), creditSoftware()),
      card(
        "settings-section",
        h("h2", { class: "card-title" }, t("credits_license_title")),
        h("p", { class: "card-text" }, t("credits_license_text")),
        h(
          "div",
          { class: "card-row" },
          linkButton(t("github_link"), () => open("project_source"), { icon: "external", fk: "cr-source" }),
          linkButton(t("about_license_link"), () => open("project_license"), { icon: "external", fk: "cr-license" }),
        ),
        h("p", { class: "small-print" }, t("credits_phoenix")),
      ),
    ),
  ]);
}

// ------------------------------------------------------------------ banners

function renderBanners(): void {
  const container = $("#banners");
  const snap = state.snap;
  const error = snap?.lastError && snap.lastError.code !== "cancelled" && !(snap.phase === "register" && snap.lastError.code === "key_rejected") ? snap.lastError : state.localError;
  const sig = JSON.stringify([state.lang, error, snap?.notice ?? null, snap?.app.updateReady ?? false, snap?.game.running ?? false]);
  renderRegion(container, sig, () => {
    const out: HTMLElement[] = [];
    if (error) {
      out.push(
        h(
          "div",
          { class: "banner banner-error", role: "alert" },
          icon("warning"),
          h("span", { class: "banner-text" }, errorText(error)),
          ...(error.code === 'account_banned' ? [linkButton('Go to support',()=>open('discord'),{fk:'ban-support'})] : []),
          linkButton(t("err_dismiss"), () => {
            state.localError = null;
            void api.dismissError();
            renderBanners();
          }, { fk: "err-dismiss" }),
        ),
      );
    }
    if (snap?.notice) {
      out.push(
        h(
          "div",
          { class: "banner banner-notice", role: "status" },
          icon("info"),
          h("span", { class: "banner-text" }, tk(`notice_${snap.notice}`)),
          linkButton(t("err_dismiss"), () => void api.dismissNotice(), { fk: "notice-dismiss" }),
        ),
      );
    }
    if (snap?.app.updateReady) {
      out.push(
        h(
          "div",
          { class: "banner banner-update", role: "status" },
          icon("refresh"),
          h("span", { class: "banner-text" }, t("update_ready")),
          button(t("update_restart"), () => void api.installUpdate(), { cls: "btn-primary", fk: "update-restart", disabled: snap.game.running }),
        ),
      );
    }
    return out;
  });
}

// ------------------------------------------------------------------ rail, titlebar, views

const NAV: { view: View; icon: IconName; key: StringKey }[] = [
  { view: "play", icon: "play", key: "nav_play" },
  { view: "news", icon: "news", key: "nav_news" },
  { view: "server", icon: "server", key: "nav_server" },
  { view: "partners", icon: "people", key: "nav_partners" },
  { view: "mods", icon: "puzzle", key: "nav_mods" },
  { view: "settings", icon: "settings", key: "nav_settings" },
];

function renderRail(): void {
  const snap = state.snap;
  const nav = $("#nav");
  const unread = state.news.length > 0 && !state.newsSeen;
  renderRegion(nav, JSON.stringify([state.lang, state.view, unread]), () =>
    NAV.map((n) => {
      const b = h(
        "button",
        { type: "button", class: "nav-item", "aria-current": state.view === n.view ? "page" : undefined, "data-fk": `nav-${n.view}` },
        icon(n.icon),
        t(n.key),
        n.view === "news" && unread ? h("img", { class: "nav-badge", src: newsBadge, alt: t("news_new"), draggable: "false" }) : null,
      );
      b.addEventListener("click", () => setView(n.view));
      return h("li", {}, b);
    }),
  );
  const chip = $("#account-chip");
  const user = snap?.account.hasKey ? snap.account.username : null;
  // With other servers saved, the chip is also the server switcher: a click lists them, one more click joins.
  const others = snap?.savedServers.filter((sv) => !sv.current) ?? [];
  const locked = !snap || snap.busy || snap.task !== null || snap.game.running;
  if (others.length === 0 || locked) state.serverMenu = false;
  renderRegion(chip, JSON.stringify([state.lang, user, snap?.server?.name ?? null, snap?.status?.name ?? null, others, locked, state.serverMenu]), () => {
    const inner = [
      h("span", { class: `avatar${user ? "" : " empty"}`, "aria-hidden": "true" }, user ? Array.from(user)[0].toUpperCase() : "?"),
      h(
        "span",
        { class: "account-text" },
        h("span", { class: "account-label" }, snap?.server ? serverName() : t("rail_not_joined")),
        h("span", { class: "account-name" }, user ?? t("rail_not_signed_in")),
      ),
    ];
    if (others.length === 0) return inner;
    const toggle = h("button", { type: "button", class: "account-switch", "data-fk": "server-switch", "aria-haspopup": "menu", "aria-expanded": state.serverMenu ? "true" : "false", title: t("saved_switch"), disabled: locked }, ...inner);
    toggle.addEventListener("click", () => {
      state.serverMenu = !state.serverMenu;
      renderRail();
    });
    const menu = h(
      "ul",
      { class: "server-menu", role: "menu", "aria-label": t("saved_switch"), hidden: !state.serverMenu },
      h("li", { class: "server-menu-head", role: "presentation" }, t("saved_switch")),
      ...others.map((sv) => {
        const item = h("button", { type: "button", class: "server-menu-item", role: "menuitem", "data-fk": `switch-${sv.id}` }, h("span", { class: "server-menu-name" }, sv.name), h("span", { class: "server-menu-sub" }, savedServerSub(sv)));
        item.addEventListener("click", () => {
          state.serverMenu = false;
          renderRail();
          void switchTo(sv.id);
        });
        return h("li", { role: "none" }, item);
      }),
    );
    return [toggle, menu];
  });
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#lang-switch .lang-btn"))) {
    b.setAttribute("aria-pressed", b.dataset.lang === state.lang ? "true" : "false");
  }
  const credits = $("#credits-btn");
  if (state.view === "credits") credits.setAttribute("aria-current", "page");
  else credits.removeAttribute("aria-current");
}

function setView(v: View): void {
  const changed = state.view !== v;
  if (v === "credits" && state.view !== "credits") {
    const from = document.activeElement;
    state.creditsReturn = { view: state.view, focus: from instanceof HTMLElement && from !== document.body ? from : null };
  }
  state.view = v;
  if (v === "news") state.newsSeen = true;
  for (const view of VIEWS) $(`#view-${view}`).hidden = view !== v;
  $("#actionbar").hidden = false;
  // The Server page shows everything the side panel shows, in full: no need for both. The Credits
  // Partners and Mods pages have long content and get the room too.
  $(".world").classList.toggle("no-panel", v === "server" || v === "credits" || v === "partners" || v === "mods");
  renderAll();
  if (changed && !reducedMotion.matches) {
    const selected = $(`#view-${v}`);
    selected.classList.remove("view-entering");
    void selected.offsetWidth;
    selected.classList.add("view-entering");
    window.setTimeout(() => selected.classList.remove("view-entering"), 520);
  }
  const heading = document.querySelector<HTMLElement>(`#view-${v} h1`);
  heading?.setAttribute("tabindex", "-1");
  if (v !== "play") heading?.focus({ preventScroll: true });
}

// Escape on the Credits page: back to the page it was opened from, with the focus on the button
// that opened it (found again by its data-fk if that page was redrawn meanwhile), or on the rail's
// Credits button.
function leaveCredits(): void {
  const back = state.creditsReturn ?? { view: "play" as View, focus: null };
  state.creditsReturn = null;
  const fk = back.focus?.getAttribute("data-fk") ?? null;
  setView(back.view);
  const again = back.focus?.isConnected
    ? back.focus
    : fk
      ? document.querySelector<HTMLElement>(`#view-${back.view} [data-fk="${CSS.escape(fk)}"]`)
      : null;
  (again ?? $("#credits-btn")).focus({ preventScroll: true });
}

function applyStaticI18n(): void {
  document.documentElement.lang = state.lang;
  document.title = t("app_title");
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"))) el.textContent = tk(el.dataset.i18n ?? "");
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-aria]"))) el.setAttribute("aria-label", tk(el.dataset.i18nAria ?? ""));
  for (const el of Array.from(document.querySelectorAll<HTMLImageElement>("img[data-i18n-alt]"))) el.alt = tk(el.dataset.i18nAlt ?? "");
  inviteInput.placeholder = t("join_placeholder");
  usernameInput.placeholder = t("reg_placeholder");
  keyInput.placeholder = t("reg_key_placeholder");
  existingGameInput.placeholder = t("install_existing_placeholder");
  $("#win-max").setAttribute("aria-label", t(state.maximized ? "window_restore" : "window_maximize"));
  $("#github-btn").title = t("github_link");
}

function renderAll(): void {
  applyStaticI18n();
  updateInviteFeedback();
  updateUsernameFeedback();
  renderRail();
  renderBanners();
  if (state.view === "play") renderPlay();
  if (state.view === "news") renderNews();
  if (state.view === "server") renderServer();
  if (state.view === "settings") renderSettings();
  if (state.view === "credits") renderCredits();
  if (state.view === "partners") renderPartners();
  if (state.view === "mods") renderMods();
  renderActionBar();
  renderPanel();
}

// ------------------------------------------------------------------ modals

function showModal(m: Modal): void {
  state.modalReturnFocus = document.activeElement as HTMLElement | null;
  state.modal = m;
  renderModal();
}

function closeModal(): void {
  state.modal = null;
  renderModal();
  state.modalReturnFocus?.focus?.();
}

function renderModal(): void {
  const root = $("#modal-root");
  const m = state.modal;
  if (!m) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  const name = serverName();
  let title = "";
  let text: HTMLElement[] = [];
  let confirmLabel = "";
  let confirmCls = "btn-primary";
  // Resolves to the next modal to show (a changed certificate), or null to close.
  let onConfirm: () => Promise<Modal | null> = async () => null;
  // Show an error from an action whose main-process side did not already report it.
  const report = async (r: { ok: boolean; error?: LauncherError }): Promise<void> => {
    if (r.ok || !r.error || r.error.code === "cancelled") return;
    if (!(await api.getSnapshot()).lastError) state.localError = r.error;
    renderBanners();
  };
  switch (m.kind) {
    case "invite":
      title = t("link_title", { name: m.name });
      text = [h("p", { class: "modal-text" }, t("link_text", { name: m.name, host: hideText(m.host) })), h("div", {}, modeBadge(m.mode))];
      if (m.fp) text.push(h("p", { class: "modal-text mono" }, t("link_fingerprint", { fp: hideText(shortFingerprint(m.fp)) })));
      if (state.snap?.server) text.push(h("p", { class: "modal-text" }, t("link_switch_note")));
      confirmLabel = t("link_join");
      onConfirm = async () => {
        const r = await api.submitInvite(m.link);
        if (!r.ok && r.error.code === "cert_changed") return inviteModal(m.link);
        await report(r);
        setView("play");
        return null;
      };
      break;
    case "cert_changed":
      title = t("certchg_title");
      text = [
        h("p", { class: "modal-text" }, t("certchg_text", { host: hideText(m.host) })),
        h(
          "dl",
          { class: "fp-compare" },
          h("dt", {}, t("certchg_old")),
          h("dd", { class: "fingerprint" }, m.oldFp ? groupedFingerprint(m.oldFp) : t("certchg_unknown")),
          h("dt", {}, t("certchg_new")),
          h("dd", { class: "fingerprint fp-new" }, groupedFingerprint(m.newFp)),
        ),
        h("p", { class: "modal-text modal-warn" }, icon("warning"), h("span", {}, t("certchg_advice"))),
      ];
      confirmLabel = t("certchg_confirm");
      confirmCls = "btn-danger";
      onConfirm = async () => {
        const r = await api.submitInvite(m.link, true);
        if (r.ok && state.inviteText.trim() === m.link) clearInviteInput();
        await report(r);
        setView("play");
        return null;
      };
      break;
    case "logout":
      title = t("logout_title", { name });
      text = [h("p", { class: "modal-text" }, t("logout_text"))];
      confirmLabel = t("logout_confirm");
      confirmCls = "btn-danger";
      onConfirm = async () => {
        await report(await api.logout());
        return null;
      };
      break;
    case "leave":
      title = t("leave_title");
      text = [h("p", { class: "modal-text" }, t("leave_text", { name }))];
      confirmLabel = t("leave_confirm");
      onConfirm = async () => {
        const r = await api.forgetServer();
        if (!r.ok) {
          await report(r);
          return null;
        }
        setView("play");
        return null;
      };
      break;
    case "remove_server":
      title = t("remove_server_title", { name: m.name });
      text = [h("p", { class: "modal-text" }, t("remove_server_text", { name: m.name }))];
      confirmLabel = t("remove_server_confirm");
      onConfirm = async () => {
        await report(await api.removeSavedServer(m.id));
        return null;
      };
      break;
  }
  const cancel = button(m.kind === "invite" ? t("link_cancel") : t("cancel"), () => closeModal(), { fk: "modal-cancel" });
  const confirm = button(confirmLabel, () => {
    confirm.disabled = true;
    void onConfirm()
      .catch(() => null)
      .then((next) => {
        if (next) {
          state.modal = next;
          renderModal();
        } else closeModal();
      });
  }, { cls: confirmCls, fk: "modal-confirm" });
  const dialog = h(
    "div",
    { class: `modal${m.kind === "cert_changed" ? " modal-danger" : ""}`, role: m.kind === "cert_changed" ? "alertdialog" : "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" },
    h("h2", { class: "modal-title", id: "modal-title" }, m.kind === "cert_changed" ? icon("shield") : null, title),
    ...text,
    h("div", { class: "modal-actions" }, cancel, confirm),
  );
  root.replaceChildren(dialog);
  root.hidden = false;
  // Destructive or risky choices never get the default focus.
  (m.kind === "logout" || m.kind === "cert_changed" || m.kind === "remove_server" ? cancel : confirm).focus();
}

// The server switcher closes on a click anywhere else, and on Escape.
window.addEventListener("mousedown", (e) => {
  if (state.serverMenu && !$("#account-chip").contains(e.target as Node)) {
    state.serverMenu = false;
    renderRail();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.serverMenu) {
    state.serverMenu = false;
    renderRail();
    document.querySelector<HTMLButtonElement>(".account-switch")?.focus();
  }
});

document.addEventListener("keydown", (e) => {
  if (!state.modal) {
    if (e.key === "Escape" && state.view === "credits" && !e.defaultPrevented) {
      e.preventDefault();
      leaveCredits();
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key === "Tab") {
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("#modal-root button:not(:disabled)"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!focusable.includes(document.activeElement as HTMLElement)) {
      e.preventDefault();
      first.focus();
    }
  }
});

// The modal for an invite: the plain "Join?" question, or the certificate warning when this PC's
// key for that public server belongs to another certificate.
async function inviteModal(link: string): Promise<Modal | null> {
  const r = parseInvite(link);
  if (!r.ok) return null;
  const inv = r.invite;
  const check = await api.checkInvite(link);
  if (check.ok && check.certificateChanged && inv.fp) {
    return { kind: "cert_changed", link, name: inv.name, host: inv.host, oldFp: check.previousFingerprint, newFp: inv.fp };
  }
  return { kind: "invite", link, name: inv.name, host: inv.host, mode: inv.mode, fp: inv.fp };
}

async function checkInviteLink(): Promise<void> {
  const link = await api.takeInviteLink();
  if (!link) return;
  const m = await inviteModal(link);
  if (m) showModal(m);
}

// ------------------------------------------------------------------ hero art (the host's art pack)

function showArt(index: number): void {
  const list = state.branding.backgrounds.filter((b) => ART_URL.test(b.url));
  const layers = [$("#art-a"), $("#art-b")];
  const credit = $("#art-credit");
  if (list.length === 0) {
    layers.forEach((l) => l.classList.remove("show"));
    credit.textContent = "";
    $("#hero").classList.remove("has-art");
    return;
  }
  const item = list[index % list.length];
  const next = layers[1 - state.artLayer];
  const img = new Image();
  img.onload = () => {
    next.style.backgroundImage = `url("${item.url}")`;
    next.classList.add("show");
    layers[state.artLayer].classList.remove("show");
    state.artLayer = 1 - state.artLayer;
    // The built-in scene is covered now: stop its animation (styles.css).
    $("#hero").classList.add("has-art");
    credit.textContent = item.credit ? t("art_credit", { credit: item.credit }) : "";
  };
  img.src = item.url;
}

function startArt(): void {
  window.clearInterval(state.artTimer);
  state.artIndex = 0;
  showArt(0);
  const count = state.branding.backgrounds.length;
  if (count > 1 && !reducedMotion.matches) {
    state.artTimer = window.setInterval(() => {
      state.artIndex++;
      showArt(state.artIndex);
    }, 14000);
  }
  const accent = state.branding.accent;
  if (accent && /^#[0-9a-f]{6}$/.test(accent)) document.documentElement.style.setProperty("--host-accent", accent);
  else document.documentElement.style.removeProperty("--host-accent");
}

// ------------------------------------------------------------------ data flow

async function loadExtras(snap: Snapshot): Promise<void> {
  if (!snap.server || snap.phase === "join" || snap.phase === "connect") return;
  const key = `${snap.server.mode}|${snap.server.host}:${snap.server.port}`;
  const empty = state.news.length === 0 && state.branding.backgrounds.length === 0;
  if (key === state.extrasFor && !(empty && Date.now() - state.extrasAt > 5000)) return;
  const changedServer = key !== state.extrasFor;
  state.extrasFor = key;
  state.extrasAt = Date.now();
  const [news, branding] = await Promise.all([api.getNews(), api.getBranding()]);
  const newsChanged = JSON.stringify(news) !== JSON.stringify(state.news);
  const artChanged = JSON.stringify(branding) !== JSON.stringify(state.branding);
  state.news = news;
  if (changedServer) state.newsSeen = false;
  if (artChanged) {
    state.branding = branding;
    startArt();
  }
  if (newsChanged || artChanged) renderAll();
}

function onSnapshot(snap: Snapshot): void {
  const langChanged = snap.settings.language !== state.lang;
  const streamerChanged = snap.settings.streamerMode !== state.snap?.settings.streamerMode;
  const serverChanged = JSON.stringify(snap.server) !== JSON.stringify(state.snap?.server ?? null);
  state.snap = snap;
  state.lang = snap.settings.language;
  if (snap.phase !== "installing") state.task = null;
  if (serverChanged && !snap.server) {
    state.news = [];
    state.branding = { backgrounds: [], accent: null };
    state.extrasFor = "";
    startArt();
  }
  if (langChanged) {
    forceRender($("#view-play"));
  }
  if (streamerChanged) refreshSecrets();
  // The game runs next to the launcher: the background holds still meanwhile (styles.css).
  $("#hero").classList.toggle("game-running", snap.game.running);
  renderAll();
  void loadExtras(snap);
}

function initChrome(): void {
  const min = $("#win-min");
  const max = $("#win-max");
  const close = $("#win-close");
  min.appendChild(icon("minimize"));
  max.appendChild(icon("maximize"));
  close.appendChild(icon("close"));
  min.addEventListener("click", () => void api.minimize());
  max.addEventListener("click", () => void api.toggleMaximize());
  close.addEventListener("click", () => void api.close());
  api.onWindowState((maximized) => {
    state.maximized = maximized;
    max.replaceChildren(icon(maximized ? "restore" : "maximize"));
    max.setAttribute("aria-label", t(maximized ? "window_restore" : "window_maximize"));
  });
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("#lang-switch .lang-btn"))) {
    b.addEventListener("click", () => void api.setSettings({ language: LANGUAGES.find((l) => l === b.dataset.lang) ?? "en" }));
  }
  // Credits, Discord and GitHub live in the rail, so they are available on every page, invite or not.
  const credits = $("#credits-btn");
  credits.prepend(icon("heart"));
  credits.addEventListener("click", () => setView("credits"));
  const github = $("#github-btn");
  github.appendChild(githubMark());
  github.addEventListener("click", () => open("project_source"));
  $("#eugamehost-btn").addEventListener("click", () => setView("partners"));
  $("#discord-btn").addEventListener("click", () => open("discord"));
  $("#patreon-btn").addEventListener("click", () => open("patreon"));
  document.addEventListener("visibilitychange", () => void api.setStatusPolling(!document.hidden));
  window.setInterval(() => {
    renderPanel();
    if (state.view === "server") renderServer();
  }, 30000);
}

async function main(): Promise<void> {
  initChrome();
  buildScene();
  applyStaticI18n();
  renderAll();
  api.onSnapshot(onSnapshot);
  api.onProgress((p) => {
    state.task = p;
    renderActionBar();
  });
  api.onInviteLink(() => void checkInviteLink());
  onSnapshot(await api.getSnapshot());
  void api.setStatusPolling(!document.hidden);
  await checkInviteLink();
}

void main();
