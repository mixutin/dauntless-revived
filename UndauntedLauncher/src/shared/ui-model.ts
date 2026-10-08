// What the UI shows for a given Snapshot. Pure functions, so the renderer's decisions can be
// tested without a DOM.

import type { StringKey } from "./i18n";
import type { ExposureMode, GraphicsPreset, Language, Phase, Snapshot, TaskProgress } from "./types";
import type { InstanceKind, PlayerWhere } from "./status";
import { formatBytes, formatDuration, formatPercent, formatSpeed } from "./format";

export type PrimaryAction = "join" | "retry" | "new_invite" | "register" | "install" | "update" | "play" | "pause" | "resume" | "none";

export interface PrimaryButton {
  labelKey: StringKey;
  action: PrimaryAction;
  disabled: boolean;
}

export interface FormState {
  inviteValid: boolean;
  usernameValid: boolean;
}

export function primaryButton(s: Snapshot, form: FormState): PrimaryButton {
  const busy = s.busy;
  switch (s.phase) {
    case "loading":
      return { labelKey: "btn_wait", action: "none", disabled: true };
    case "join":
      return { labelKey: busy ? "btn_wait" : "btn_join", action: "join", disabled: busy || !form.inviteValid };
    case "connect":
      if (s.connect.checking) return { labelKey: "btn_wait", action: "none", disabled: true };
      // A server with the wrong certificate was refused on purpose: retrying does not help, a new
      // invite from the host does.
      if (s.connect.problem === "cert_mismatch") return { labelKey: "btn_new_invite", action: "new_invite", disabled: busy };
      return { labelKey: "btn_retry", action: "retry", disabled: busy };
    case "register":
      return {
        labelKey: busy ? "btn_wait" : "btn_register",
        action: "register",
        disabled: busy || !form.usernameValid || s.status?.registration === "NONE",
      };
    case "install": {
      const lowSpace = s.install.freeBytes !== null && s.install.freeBytes < s.install.requiredBytes;
      return { labelKey: "btn_install", action: "install", disabled: busy || !s.install.contentAvailable || lowSpace };
    }
    case "installing":
      if (s.task?.kind === "download") {
        return s.task.paused
          ? { labelKey: "btn_resume", action: "resume", disabled: false }
          : { labelKey: "btn_pause", action: "pause", disabled: false };
      }
      return { labelKey: "btn_wait", action: "none", disabled: true };
    case "update":
      return { labelKey: busy ? "btn_wait" : "btn_update", action: "update", disabled: busy };
    case "ready":
      return { labelKey: busy ? "btn_wait" : "btn_play", action: "play", disabled: busy };
    case "running":
      return { labelKey: "btn_running", action: "none", disabled: true };
  }
}

// 0 Join, 1 Register, 2 Install, 3 Play
export function stepIndex(phase: Phase): number {
  switch (phase) {
    case "loading":
    case "join":
    case "connect":
      return 0;
    case "register":
      return 1;
    case "install":
    case "installing":
    case "update":
      return 2;
    case "ready":
    case "running":
      return 3;
  }
}

export interface TaskView {
  titleKey: StringKey;
  percent: number;
  bytesText: string | null; // "1.2 GB of 10.9 GB"
  speedText: string | null;
  etaText: string | null;
  filesText: string;
  indeterminate: boolean;
}

export function taskView(t: TaskProgress, lang: Language): TaskView {
  const titleKey: StringKey =
    t.kind === "download" ? (t.paused ? "task_download_paused" : "task_download") : t.kind === "dlls" ? "task_dlls" : "task_verify";
  const bytesTask = t.kind === "download" || (t.kind === "verify" && t.totalBytes > t.filesTotal);
  return {
    titleKey,
    percent: formatPercent(t.doneBytes, t.totalBytes),
    bytesText: bytesTask ? `${formatBytes(t.doneBytes, lang)} / ${formatBytes(t.totalBytes, lang)}` : null,
    speedText: t.kind === "download" && !t.paused && t.bytesPerSecond > 0 ? formatSpeed(t.bytesPerSecond, lang) : null,
    etaText: t.kind === "download" && !t.paused && t.etaSeconds !== null ? formatDuration(t.etaSeconds, lang) : null,
    filesText: `${t.filesDone}/${t.filesTotal}`,
    indeterminate: t.kind === "dlls",
  };
}

export function whereKey(w: PlayerWhere): StringKey {
  return `where_${w}` as StringKey;
}

export function kindKey(k: InstanceKind): StringKey {
  return `kind_${k}` as StringKey;
}

export function graphicsKey(g: GraphicsPreset): StringKey {
  return g === "deck" ? "gfx_deck" : g < 0 ? "gfx_menu" : (`gfx_${g}` as StringKey);
}

export function exposureKey(m: ExposureMode): StringKey {
  return `exposure_${m}` as StringKey;
}

export function playersKey(n: number): StringKey {
  return n === 1 ? "sp_players_one" : "sp_players_other";
}

export type UpdateReason = "missing" | "dlls" | "unverified";

export function updateReason(s: Snapshot): UpdateReason {
  if (s.install.missingFiles > 0) return "missing";
  if (!s.install.verified) return "unverified";
  return "dlls";
}

// A short display form of a game file path: the file name only.
export function shortFile(p: string | null): string | null {
  if (!p) return null;
  const name = p.split("/").pop() ?? p;
  return name.length > 48 ? name.slice(0, 45) + "…" : name;
}
