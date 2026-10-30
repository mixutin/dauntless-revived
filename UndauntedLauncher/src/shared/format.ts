// Number formatting for the UI (bytes, speed, time left, running time).
import type { Language } from "./types";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number, lang: Language = "en"): string {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits);
  return `${lang === "en" || lang === "ja" ? text : text.replace(".", ",")} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number, lang: Language = "en"): string {
  return `${formatBytes(bytesPerSecond, lang)}/s`;
}

// 277200 -> "3 d 5 h", 3725 -> "1 h 2 min", 95 -> "1 min 35 s", 12 -> "12 s"
export function formatDuration(seconds: number | null, lang: Language = "en"): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "–";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hUnit = lang === "fi" ? "t" : "h";
  if (h >= 24) return `${Math.floor(h / 24)} ${lang === "fi" ? "vrk" : "d"} ${h % 24} ${hUnit}`;
  if (h > 0) return `${h} ${hUnit} ${m} min`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}

// Total time played, in hours and minutes only: 547200 -> "152 h 0 min", 2700 -> "45 min"
export function formatPlaytime(seconds: number, lang: Language = "en"): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ${lang === "fi" ? "t" : "h"} ${m} min`;
  return `${m} min`;
}

export function formatPercent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 1000) / 10));
}

const JUST_STARTED: Record<Language, string> = {
  en: "just started",
  fi: "juuri alkanut",
  de: "gerade gestartet",
  es: "recién iniciado",
  fr: "vient de démarrer",
  it: "appena avviato",
  ja: "開始直後",
  pt: "recém-iniciado",
  ru: "только что запущен",
};

// "running for" on instance cards: 42 min, 3 h 5 min, 2 d 4 h
export function formatRunningTime(startedAt: string | null, now: number, lang: Language = "en"): string {
  if (startedAt === null) return "–";
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return "–";
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return JUST_STARTED[lang];
  if (minutes < 60) return `${minutes} min`;
  return formatDuration(minutes * 60, lang);
}

export function formatDate(iso: string | null, lang: Language = "en"): string {
  if (iso === null) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  if (lang === "fi" || lang === "de" || lang === "ru") return `${day}.${month}.${year}`;
  if (lang === "ja") return `${year}年${month}月${day}日`;
  if (lang === "fr" || lang === "it" || lang === "pt") return `${day}/${month}/${year}`;
  if (lang === "es") return `${day} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"][month - 1]} ${year}`;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${names[month - 1]} ${year}`;
}
