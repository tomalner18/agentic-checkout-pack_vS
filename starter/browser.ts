import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';

export interface PageElement {
  id: string;
  tag: string;
  type: string | null;
  name: string;
  context?: string;
  filled?: boolean;
  dateValue?: string;
  readOnly?: boolean;
  checked: boolean | null;
  disabled: boolean;
  options?: string[];
  /** A link target is kept inside the browser guard, never returned to the model. */
}
export interface Observation {
  id: string;
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  excludedFrames: number;
  blocked: boolean;
}
export type Action =
  | { kind: 'click'; id: string }
  | { kind: 'fill' | 'select'; id: string; value: string }
  | { kind: 'check'; id: string; checked: boolean };
export type Control = 'agent' | 'traveller' | 'verifying' | 'stopped';
interface Guard {
  origin: string;
  control: Control;
  observation?: Observation;
  revision: number;
  usedSubmissions: Set<string>;
}
const guards = new WeakMap<Page, Guard>();

export function safeUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.origin}${u.pathname}`; } catch { return '[unavailable]'; }
}
export function allowedUrl(raw: string, origin: string): boolean {
  try {
    const u = new URL(raw);
    return u.origin === origin && /^https?:$/.test(u.protocol) && !u.username && !u.password &&
      !/(?:^|\/)(?:__[^/]*|admin|phone)(?:\/|$)/i.test(u.pathname);
  } catch { return false; }
}
export function protectPage(page: Page, hotelUrl: string): void {
  const origin = new URL(hotelUrl).origin;
  if (!allowedUrl(hotelUrl, origin)) throw new Error('UNSAFE_HOTEL_URL');
  guards.set(page, { origin, control: 'agent', revision: 0, usedSubmissions: new Set() });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) {
    const guard = guards.get(page); if (guard) { guard.revision++; guard.observation = undefined; }
  } });
}
function guardFor(page: Page): Guard {
  const guard = guards.get(page);
  if (!guard) throw new Error('UNPROTECTED_PAGE');
  return guard;
}
export function setControl(page: Page, control: Control): void {
  const g = guardFor(page);
  g.control = control;
  g.revision++;
  g.observation = undefined;
}
export function getControl(page: Page): Control { return guardFor(page).control; }

export async function openBrowser(opts: { headless?: boolean } = {}): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: opts.headless ?? false });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-GB' });
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  return { browser, page: await context.newPage() };
}

export async function observe(page: Page, maxText = 18000): Promise<Observation> {
  const g = guardFor(page);
  if (g.control !== 'agent' && g.control !== 'verifying') throw new Error('HUMAN_CONTROL');
  g.observation = undefined;
  const id = randomUUID();
  const blocked = (): Observation => ({ id, url: '[restricted]', title: '', text: '', elements: [], excludedFrames: 0, blocked: true });
  if (!allowedUrl(page.url(), g.origin)) return blocked();
  const revision = g.revision;
  // Only the main document is inspected. Payment iframe documents are never evaluated.
  // Classification uses field metadata only, before text/name/value extraction.
  const found = await page.evaluate(({ id, maxText }) => {
    const sensitive = /(?:password|passcode|one.time|otp|cvc|cvv|card.?number|cardholder|cc-number|cc-exp|cc-csc|iban|passport|national.?id|verification.?code|security.?code)/i;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('input,select,textarea,[contenteditable=true]'));
    const unsafe = controls.some(el => {
      const metadata = ['type', 'name', 'id', 'autocomplete', 'placeholder', 'aria-label'].map(a => el.getAttribute(a) || '').join(' ');
      return sensitive.test(metadata) || el.getAttribute('type') === 'file' || el.hasAttribute('contenteditable');
    });
    if (unsafe) return { blocked: true, title: '', text: '', elements: [] as PageElement[] };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const nameOf = (el: HTMLElement) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.slice(0, 250);
      const fieldId = el.getAttribute('id');
      const label = (fieldId ? document.querySelector(`label[for="${CSS.escape(fieldId)}"]`) : null) ?? el.closest('label');
      if (label) return (label.textContent || '').trim().slice(0, 250);
      return (el.getAttribute('data-date') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('name') || '').trim().slice(0, 250);
    };
    const contextOf = (el: HTMLElement) => {
      if (el.hasAttribute('data-date')) return '';
      const interactive = 'a[href],button,input,select,textarea,[role=button]';
      let fallback = '';
      let actionContext = '';
      let nearestHeading = '';
      let roomDescription = '';
      let parent = el.parentElement;
      for (let depth = 0; parent && parent !== document.body && depth < 7; depth++, parent = parent.parentElement) {
        const text = (parent.innerText || '').replace(/\s+/g, ' ').trim();
        if (text && text.length <= 900) fallback = text;
        const controls = parent.querySelectorAll(interactive).length;
        if (!nearestHeading) {
          const heading = parent.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
          nearestHeading = (heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          if (heading) roomDescription = (parent.querySelector('p')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
        }
        // Keep expanding while this ancestor still contains only this action. That captures
        // the full room/rate card around a small button without absorbing neighboring offers.
        if (text.length >= 20 && text.length <= 580 && controls === 1) actionContext = text;
      }
      if (actionContext) return `${nearestHeading} ${roomDescription} ${actionContext}`.trim().slice(0, 700);
      return fallback.slice(0, 700);
    };
    const elements: PageElement[] = [];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[role=button],[onclick],[data-date]'))) {
      if (el.getAttribute('type') === 'hidden' || !visible(el)) continue;
      const eid = `${id}:${n++}`; el.setAttribute('data-agent-id', eid);
      const input = el as HTMLInputElement;
      const context = contextOf(el);
      const dateField = el.getAttribute('type') === 'date' || /(?:check.?in|check.?out|arrival.?date|departure.?date)/i.test([el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('aria-label'), nameOf(el)].join(' '));
      elements.push({ id: eid, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), name: nameOf(el), context,
        checked: input.type === 'checkbox' || input.type === 'radio' ? input.checked : null,
        disabled: input.disabled === true || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        ...(el.tagName === 'INPUT' ? { filled: !!input.value, readOnly: input.readOnly, ...(dateField ? { dateValue: input.value.slice(0, 40) } : {}) } : {}),
        ...(el.tagName === 'SELECT' ? { options: Array.from((el as HTMLSelectElement).options).map(o => o.label) } : {}),
      });
    }
    // body.innerText does not descend into iframe documents. Form values are not read.
    const text = (document.body?.innerText || '').replace(/(?:the )?card ending\s+\d{4}[^\n]*/gi, '[card receipt omitted]');
    return { blocked: false, title: document.title.slice(0, 250), text: text.trim().slice(0, maxText), elements };
  }, { id, maxText });
  if (revision !== g.revision || (g.control !== 'agent' && g.control !== 'verifying') || !allowedUrl(page.url(), g.origin)) return blocked();
  const observation: Observation = { id, url: safeUrl(page.url()), ...found, excludedFrames: Math.max(0, page.frames().length - 1) };
  g.observation = observation;
  return observation;
}

const finalAction = /(?:\bpay\b|payment|\bconfirm\b|\bcomplete\b|\bpurchase\b|\bsubmit\b|\bsend\b|\bplace order\b|\bfinali[sz]e\b|\bcommit\b|\bauthori[sz]e\b|\bguarantee\b|accept.*terms|terms.*accept|\bbook\b|\breserv(?:e|ation)\b)/i;
const preparatoryAction = /(?:search|availability|choose|select|details|continue|next|previous|proceed|back|rooms|rates|show|view|more|fewer|read|manage choices|reject|necessary|save choices|check.in|check.out|no thanks|keep|upgrade|\b20\d\d\b)/i;
const bookingCommitment = /(?:\bcontinu(?:e|ing)\b.{0,100}\b(?:creates?|makes?|places?|submits?|confirms?|completes?|books?|reserves?|finali[sz]es?|commits?)\b.{0,60}\b(?:your\s+)?(?:booking|reservation|room|stay)\b|\b(?:booking|reservation|room|stay)\b.{0,60}\b(?:will be|is being|gets?|is)\s+(?:created|made|placed|submitted|confirmed|booked|reserved)\b.{0,60}\b(?:continu|proceed|next step)\b|\b(?:continu(?:e|ing)|proceed(?:ing)?)\b.{0,60}\b(?:will|may|automatically)\s+(?:book|reserve|confirm|create|place|submit|finali[sz]e)\b.{0,60}\b(?:booking|reservation|room|stay)\b|\b(?:continu(?:e|ing)|proceed(?:ing)?)\b.{0,80}\b(?:charge|collect|take)\b.{0,30}\b(?:payment|money|card)\b|\bby continu(?:ing|e)\b.{0,100}\b(?:book|reserv|accept the terms|cancellation fees apply)\b)/i;
function explicitNoBookingBoundary(text: string): boolean {
  const deniesBooking = /(?:\bno\s+(?:booking|reservation)\b|\bnot yet booked\b|\b(?:not|will not|won't|does not|doesn't|has not|hasn't|is not|isn't)\b.{0,60}\b(?:book(?:ed|ing)?|reserv(?:e|ed|ation)|create|place|submit|confirm)\b)/i.test(text);
  const namesLaterBoundary = /\b(?:until|unless|before|after|next step|next page|final step|final confirmation|final booking|still need to|still have to)\b/i.test(text);
  return deniesBooking && namesLaterBoundary;
}

function actionCrossesNamedBoundary(text: string, actionName: string): boolean {
  const target = actionName.toLowerCase().replace(/^(?:click|press)\s+/i, '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  return !!target && new RegExp(`\\b(?:until|when|after|by|on)\\s+(?:you\\s+)?(?:click|press|select|choose)?\\s*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalized);
}

export function actionPermitted(action: Action, observation: Observation, nonBindingEvidence = ''): boolean {
  const el = observation.elements.find(e => e.id === action.id);
  if (!el || el.disabled || observation.blocked) return false;
  if (observation.excludedFrames > 0) return false;
  if (action.kind === 'fill' || action.kind === 'select') return ['input', 'select', 'textarea'].includes(el.tag) && !el.readOnly;
  if (action.kind === 'check') {
    if (/terms|conditions|accept|agree|guarantee|payment/i.test(el.name)) return false;
    return el.type === 'checkbox' || el.type === 'radio';
  }
  // Nothing on checkout can be clicked by the agent. Reading and quoting remain possible.
  if (/accept.{0,60}(?:terms|conditions)/i.test(observation.text)) return false;
  if (finalAction.test(el.name)) {
    return /continue|proceed|next/i.test(el.name) && stagedGuestDetails(observation, el.name) && evidenceAllowsPreparation(nonBindingEvidence, observation, el);
  }
  if (/^(?:next|previous|prior) month$/i.test(el.name.trim())) return true;
  if (/continue|proceed|next/i.test(el.name)) return evidenceAllowsPreparation(nonBindingEvidence, observation, el);
  return preparatoryAction.test(el.name) || (el.tag === 'input' && ['date', 'radio'].includes(el.type || ''));
}
function stagedGuestDetails(observation: Observation, label: string): boolean {
  const fieldNames = observation.elements.filter(e => e.tag === 'input').map(e => e.name.toLowerCase());
  return /^(?:continue|proceed|next) to payment$/i.test(label.trim()) &&
    /your details|guest details/i.test(observation.text) &&
    ['first name', 'last name', 'email'].every(n => fieldNames.some(f => f.includes(n))) &&
    !/card number|cvv|cvc|accept (?:the )?(?:booking )?conditions/i.test(observation.text);
}
function evidenceAllowsPreparation(evidence: string, observation: Observation, element: PageElement): boolean {
  const excerpt = evidence.trim();
  if (bookingCommitment.test(observation.text) || bookingCommitment.test(element.context || '')) return false;
  if (/card (?:authori[sz]ation|hold)|authori[sz]e (?:your )?card|deposit (?:will be|is) (?:charged|taken)/i.test(observation.text + ' ' + element.context)) return false;
  if (actionCrossesNamedBoundary(observation.text, element.name)) return false;
  if (stagedGuestDetails(observation, element.name)) {
    // A recognisable guest-details step can be preparatory without a disclaimer.
    // Conflicting or action-specific commitment wording is still a hard stop.
    return !excerpt || (observation.text.includes(excerpt) && !!element.context?.includes(excerpt));
  }
  return excerpt.length >= 12 && observation.text.includes(excerpt) && !!element.context?.includes(excerpt) && explicitNoBookingBoundary(excerpt);
}

export function needsTravellerForCommitment(action: Action, observation: Observation): boolean {
  const el = observation.elements.find(e => e.id === action.id);
  return !!el && action.kind === 'click' && stagedGuestDetails(observation, el.name) &&
    /continue|proceed|next/i.test(el.name) && !actionPermitted(action, observation);
}

export async function act(page: Page, action: Action, nonBindingEvidence = ''): Promise<void> {
  const g = guardFor(page);
  if (g.control !== 'agent') throw new Error('ACTIONS_DISABLED');
  const seen = g.observation;
  if (!seen || !allowedUrl(page.url(), g.origin) || safeUrl(page.url()) !== seen.url || !actionPermitted(action, seen, nonBindingEvidence)) throw new Error('ACTION_NOT_PERMITTED');
  const revision = g.revision;
  g.observation = undefined; // consume IDs even when Playwright fails: never blindly retry a submission
  const el = page.locator(`[data-agent-id="${action.id}"]`);
  let meta: { tag: string; href: string; formAction: string; submit: boolean; descriptor: string };
  try {
    meta = await el.evaluate(element => ({
      tag: element.tagName, href: element instanceof HTMLAnchorElement ? element.href : '',
      formAction: element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.form?.action || '' : '',
      submit: (element instanceof HTMLButtonElement && element.type === 'submit') || (element instanceof HTMLInputElement && element.type === 'submit'),
      descriptor: ['type', 'name', 'id', 'autocomplete'].map(k => element.getAttribute(k) || '').join(' '),
    }), undefined, { timeout: 5000 });
  } catch { throw new Error('ACTION_UNCERTAIN_REOBSERVE'); }
  if (g.control !== 'agent' || g.revision !== revision || !allowedUrl(page.url(), g.origin)) throw new Error('ACTION_STALE');
  if (/password|passcode|otp|cvc|cvv|card|cc-|iban|passport|verification/i.test(meta.descriptor)) throw new Error('SENSITIVE_ACTION_BLOCKED');
  if ((meta.href && !allowedUrl(meta.href, g.origin)) || (meta.formAction && !allowedUrl(meta.formAction, g.origin))) throw new Error('FOREIGN_ACTION_BLOCKED');
  if (action.kind === 'click' && meta.submit && !/search|availability/i.test(seen.elements.find(e => e.id === action.id)?.name || '')) {
    const fingerprint = `${seen.url}:${seen.elements.find(e => e.id === action.id)?.name}`;
    if (g.usedSubmissions.has(fingerprint)) throw new Error('SUBMISSION_ALREADY_ATTEMPTED');
    g.usedSubmissions.add(fingerprint);
  }
  try {
    if (action.kind === 'click') await el.click({ timeout: 5000 });
    if (action.kind === 'fill') await el.fill(action.value, { timeout: 5000 });
    if (action.kind === 'select') await el.selectOption({ label: action.value }, { timeout: 5000 });
    if (action.kind === 'check') await el.setChecked(action.checked, { timeout: 5000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
  } catch { throw new Error('ACTION_UNCERTAIN_REOBSERVE'); }
}

/** Screenshots cannot safely isolate arbitrary sensitive overlays. Disabled for the prototype. */
export async function screenshot(_page: Page): Promise<Buffer> { throw new Error('SCREENSHOTS_DISABLED'); }
