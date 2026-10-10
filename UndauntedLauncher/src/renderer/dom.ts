// Small DOM helpers. Text is always set with textContent and attributes with setAttribute, so
// nothing that comes from a server can ever be parsed as HTML.

type Child = Node | string | number | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;

export function $(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el as HTMLElement;
}

function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

function setAttrs(el: Element, attrs: Record<string, AttrValue>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, AttrValue> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, AttrValue> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

// Line icons on a 24x24 grid, drawn for this launcher.
const ICONS = {
  play: [["path", { d: "M8 5.2v13.6L19 12z", fill: "currentColor", stroke: "none" }]],
  news: [["path", { d: "M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H6.5A2 2 0 0 1 4.5 17.5V5zM18 9h1.5v9a1.5 1.5 0 0 1-3 0M8 8.5h6.5M8 12h6.5M8 15.5h4" }]],
  server: [["path", { d: "M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15zM8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4" }]],
  settings: [
    ["path", { d: "M4 7h9M17 7h3M4 17h3M11 17h9" }],
    ["circle", { cx: 15, cy: 7, r: 2 }],
    ["circle", { cx: 9, cy: 17, r: 2 }],
  ],
  minimize: [["path", { d: "M6 12.5h12" }]],
  gamepad: [["path", { d: "M7.5 8.5h9a4 4 0 0 1 3.9 4.9l-.8 3.5a1.9 1.9 0 0 1-3.2.9L14.2 15.5H9.8l-2.2 2.3a1.9 1.9 0 0 1-3.2-.9l-.8-3.5a4 4 0 0 1 3.9-4.9zM8.5 11v3.5M6.75 12.75h3.5M15.5 12h.01M17.5 13.75h.01" }]],
  monitor: [["path", { d: "M3.5 5h17v11.5h-17zM8.5 20h7M12 16.5V20" }]],
  user: [
    ["circle", { cx: 12, cy: 8.5, r: 3.5 }],
    ["path", { d: "M5 19.5c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" }],
  ],
  maximize: [["path", { d: "M6.5 6.5h11v11h-11z" }]],
  restore: [["path", { d: "M8.5 8.5h9v9h-9zM6.5 15.5v-9h9" }]],
  close: [["path", { d: "M7 7l10 10M17 7L7 17" }]],
  people: [["path", { d: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.3a3 3 0 0 1 0 5.4M17 13.6a5.5 5.5 0 0 1 3.5 5.4" }]],
  puzzle: [["path", { d: "M10 5.5a2 2 0 0 1 4 0V7h3.5A1.5 1.5 0 0 1 19 8.5V11h-1a2 2 0 0 0 0 4h1v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1a2 2 0 0 0-4 0v1H6.5A1.5 1.5 0 0 1 5 18.5V15h1a2 2 0 0 0 0-4H5V8.5A1.5 1.5 0 0 1 6.5 7H10z" }]],
  city: [["path", { d: "M3.5 20h17M5 20v-8l4-3 4 3v8M13 20V8l3-3.5L19 8v12M8 16h2M15.5 11h1M15.5 14.5h1" }]],
  hunt: [
    ["circle", { cx: 12, cy: 12, r: 7.5 }],
    ["circle", { cx: 12, cy: 12, r: 2.5 }],
    ["path", { d: "M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" }],
  ],
  dojo: [["path", { d: "M3.5 6.5c3 .8 14 .8 17 0M5.5 10h13M7 7.2V20M17 7.2V20M11 10v3.5h2V10" }]],
  tutorial: [["path", { d: "M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" }]],
  shield: [["path", { d: "M12 3l7 2.8V11c0 4.6-3 7.9-7 10-4-2.1-7-5.4-7-10V5.8zM9 12l2.2 2.2L15.5 10" }]],
  tunnel: [["path", { d: "M4 18a8 8 0 0 1 16 0M8 18a4 4 0 0 1 8 0M3 18h18" }]],
  external: [["path", { d: "M14 4.5h5.5V10M19.5 4.5L11 13M10 6.5H6A1.5 1.5 0 0 0 4.5 8v10A1.5 1.5 0 0 0 6 19.5h10a1.5 1.5 0 0 0 1.5-1.5v-4" }]],
  folder: [["path", { d: "M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" }]],
  refresh: [["path", { d: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" }]],
  warning: [["path", { d: "M12 4l9 15.5H3zM12 10v4.5M12 17h.01" }]],
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
  info: [
    ["circle", { cx: 12, cy: 12, r: 8.5 }],
    ["path", { d: "M12 11v5.5M12 8h.01" }],
  ],
  key: [["path", { d: "M14.5 9.5a4.5 4.5 0 1 1-1.4-3.3M13.1 6.2L20 13v3h-3v-2.5h-2.5V11" }]],
  pause: [["path", { d: "M8.5 6v12M15.5 6v12" }]],
  globe: [
    ["circle", { cx: 12, cy: 12, r: 8.5 }],
    ["path", { d: "M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" }]],
  heart: [["path", { d: "M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z" }]],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = "icon"): SVGSVGElement {
  const svg = s("svg", {
    class: cls,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.8,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  });
  for (const [tag, attrs] of ICONS[name]) svg.appendChild(s(tag as "path", attrs as Record<string, AttrValue>));
  return svg;
}

// The GitHub mark: the Octicon "mark-github" (16 px grid) from GitHub Octicons, MIT license (see
// THIRD-PARTY-NOTICES.txt). Its shape is used unmodified, in one colour (currentColor), and only
// to link to this project's own repository, as GitHub's logo guidelines ask.
const GITHUB_MARK_16 =
  "M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656";

export function githubMark(cls = "icon mark"): SVGSVGElement {
  return s("svg", { class: cls, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true", focusable: "false" }, s("path", { d: GITHUB_MARK_16 }));
}

// Rebuilds a region only when its content signature changed, and keeps keyboard focus on the
// element with the same data-fk key.
const signatures = new WeakMap<Element, string>();

export function renderRegion(container: HTMLElement, signature: string, build: () => Child[]): void {
  if (signatures.get(container) === signature) return;
  signatures.set(container, signature);
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active && container.contains(active) ? active.getAttribute("data-fk") : null;
  let selection: [number, number] | null = null;
  if (active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && container.contains(active)) {
    selection = [active.selectionStart ?? 0, active.selectionEnd ?? 0];
  }
  container.replaceChildren();
  append(container, build());
  if (focusKey) {
    const again = container.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`) as HTMLElement | null;
    if (again) {
      again.focus({ preventScroll: true });
      if (selection && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
        again.setSelectionRange(selection[0], selection[1]);
      }
    }
  }
}

export function forceRender(container: HTMLElement): void {
  signatures.delete(container);
}
