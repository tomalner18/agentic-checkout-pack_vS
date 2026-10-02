// Browser plumbing: open a page, describe what's on it, do one thing to it.
//
// This is deliberately dumb. It lists what is visible and clickable in every
// frame and lets you act on an element by id. Deciding what to look at, what a
// model is allowed to touch, and when to stop is yours.

import { chromium, type Browser, type Frame, type Page } from "playwright";

export interface PageElement {
  /** Stable for one observation only. Re-observe after every action. */
  id: string;
  frameUrl: string;
  tag: string;
  role: string | null;
  type: string | null;
  /** Best-effort accessible name: aria-label, label, placeholder or text. */
  name: string;
  value: string | null;
  checked: boolean | null;
  disabled: boolean;
}

export interface Observation {
  url: string;
  title: string;
  /** Visible text per frame, trimmed. Frame 0 is the top page. */
  text: { frameUrl: string; text: string }[];
  elements: PageElement[];
}

export type Action =
  | { kind: "click"; id: string }
  | { kind: "fill"; id: string; value: string }
  | { kind: "select"; id: string; value: string }
  | { kind: "check"; id: string; checked: boolean }
  | { kind: "goto"; url: string };

export async function openBrowser(opts: { headless?: boolean } = {}): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: opts.headless ?? false });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "en-GB" });
  // tsx compiles functions passed to page.evaluate with a `__name` helper that
  // only exists in Node; without this shim every evaluate fails in the page.
  await context.addInitScript({ content: "globalThis.__name = (f) => f;" });
  const page = await context.newPage();
  return { browser, page };
}

const frames = new WeakMap<Page, Frame[]>();

export async function observe(page: Page, maxText = 4000): Promise<Observation> {
  const all = page.frames();
  frames.set(page, all);
  const text: Observation["text"] = [];
  const elements: PageElement[] = [];

  for (const [fi, frame] of all.entries()) {
    try {
      const found = await frame.evaluate(
        ({ fi, maxText }) => {
          const visible = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
          };
          const nameOf = (el: HTMLElement) => {
            const aria = el.getAttribute("aria-label");
            if (aria) return aria;
            const id = el.getAttribute("id");
            const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const wrap = el.closest("label");
            const label = (forLabel ?? wrap)?.textContent?.trim();
            if (label) return label;
            const ph = el.getAttribute("placeholder");
            if (ph) return ph;
            return (el.innerText || (el as HTMLInputElement).value || "").trim().slice(0, 120);
          };
          const sel = "a[href],button,input,select,textarea,[role=button],[onclick],[data-date]";
          const out: any[] = [];
          let n = 0;
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
            if ((el as HTMLInputElement).type === "hidden" || !visible(el)) continue;
            const id = `${fi}:${n++}`;
            el.setAttribute("data-agent-id", id);
            const input = el as HTMLInputElement;
            out.push({
              id,
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute("role"),
              type: el.getAttribute("type"),
              name: nameOf(el),
              value: "value" in el ? String(input.value ?? "") : null,
              checked: input.type === "checkbox" || input.type === "radio" ? input.checked : null,
              disabled: input.disabled === true,
            });
          }
          return { text: (document.body?.innerText ?? "").trim().slice(0, maxText), elements: out };
        },
        { fi, maxText },
      );
      text.push({ frameUrl: frame.url(), text: found.text });
      for (const e of found.elements) elements.push({ ...e, frameUrl: frame.url() });
    } catch (e) {
      // A frame can navigate away mid-evaluate; the next observe sees it again.
      text.push({ frameUrl: frame.url(), text: `[could not read this frame: ${String(e).slice(0, 200)}]` });
    }
  }
  return { url: page.url(), title: await page.title(), text, elements };
}

export async function act(page: Page, action: Action): Promise<void> {
  if (action.kind === "goto") {
    await page.goto(action.url);
    return;
  }
  const [fi] = action.id.split(":");
  const frame = frames.get(page)?.[Number(fi)];
  if (!frame) throw new Error(`no frame for ${action.id}; observe again`);
  const el = frame.locator(`[data-agent-id="${action.id}"]`);
  switch (action.kind) {
    case "click":
      await el.click({ timeout: 5000 });
      break;
    case "fill":
      await el.fill(action.value, { timeout: 5000 });
      break;
    case "select":
      await el.selectOption({ label: action.value }, { timeout: 5000 });
      break;
    case "check":
      await el.setChecked(action.checked, { timeout: 5000 });
      break;
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

export async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: false });
}
