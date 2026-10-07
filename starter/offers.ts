import { createHash } from 'node:crypto';
import type { Observation, PageElement } from './browser.ts';
import { budgetStatus, parseCurrencyAmount, stayNights, type PriceBasis } from './budget.ts';

export interface SearchRequest {
  checkin: string;
  checkout: string;
  adults: number | null;
  hardRequirements: string[];
  preferences: string[];
  exclusions: string[];
}

export interface OfferCandidate {
  key: string;
  observationId: string;
  actionName: string;
  context: string;
  label: string;
  price: string | null;
  currency: string | null;
  amount: number | null;
  comparable: boolean;
  priceBasis: PriceBasis;
  priceComplete: boolean;
  hardConflicts: string[];
  unverified: string[];
  softMatches: string[];
  softMisses: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
const currencyAmount = /(?:€|£|\$|EUR|GBP|USD)\s?\d[\d,.]*/gi;
function priceOf(context: string, request: SearchRequest): { price: string | null; amount: number | null; currency: string | null; priceBasis: PriceBasis; priceComplete: boolean } {
  const matches = [...context.matchAll(currencyAmount)];
  const empty = { price: null, amount: null, currency: null, priceBasis: 'unknown' as const, priceComplete: false };
  if (!matches.length) return empty;
  const candidates = matches.map(match => {
    const at = match.index || 0;
    const nearby = context.slice(Math.max(0, at - 30), Math.min(context.length, at + match[0].length + 35));
    const before = context.slice(Math.max(0, at - 35), at);
    const excluded = /(?:tourist|city|local|municipal)\s+tax|breakfast|per person|upgrade|more per night/i.test(before);
    const preferred = /(?:grand\s+)?total|(?:room|stay)\s+price|price\s*(?:from)?/i.test(before);
    return { match, nearby, excluded, preferred };
  });
  const preferred = candidates.filter(candidate => candidate.preferred && !candidate.excluded);
  const usable = preferred.length === 1 ? preferred : candidates.filter(candidate => !candidate.excluded);
  if (usable.length !== 1) return empty;
  const chosen = usable[0];
  const parsed = parseCurrencyAmount(chosen.match[0]);
  if (!parsed) return empty;
  const nights = stayNights(request.checkin, request.checkout);
  const nightly = /(?:per\s*night|\/\s*night|nightly)/i.test(chosen.nearby);
  const stayCount = context.match(/\b(\d+)\s*nights?\b/i)?.[1];
  const stayBasis = /\b(?:grand\s+)?total\b|\bstay\s+price\b/i.test(chosen.nearby) || !!stayCount && !!nights && Number(stayCount) === nights;
  const priceBasis: PriceBasis = nightly ? 'night' : stayBasis ? 'stay' : 'unknown';
  const amount = priceBasis === 'night' && nights ? parsed.amount * nights : priceBasis === 'stay' ? parsed.amount : null;
  const priceComplete = /(?:all|mandatory)\s+(?:tax(?:es)?|fees?)\s+(?:and\s+(?:tax(?:es)?|fees?)\s+)?included|includes?\s+(?:all\s+)?(?:tax(?:es)?|mandatory\s+fees?)/i.test(context);
  return { price: chosen.match[0], amount, currency: parsed.currency, priceBasis, priceComplete };
}

function classify(context: string, request: SearchRequest, price: ReturnType<typeof priceOf>, comparable: boolean): Pick<OfferCandidate, 'hardConflicts' | 'unverified' | 'softMatches' | 'softMisses'> {
  const text = norm(context);
  const hardConflicts: string[] = [];
  const unverified: string[] = [];
  for (const requirement of request.hardRequirements) {
    if (/cancel|refund|flexib/i.test(requirement)) {
      if (/non[ -]?refundable|no refunds?|not refundable|no cancellation/i.test(text)) hardConflicts.push(requirement);
      else if (!/free cancellation|fully refundable|refundable/i.test(text)) unverified.push(requirement);
    } else if (/\b(?:maximum|max|budget|under|below|up to)\b/i.test(requirement)) {
      const status = budgetStatus(requirement, { currency: comparable ? price.currency : null, stayAmount: price.amount,
        nights: stayNights(request.checkin, request.checkout), complete: price.priceComplete });
      if (status === 'conflict') hardConflicts.push(requirement);
      else if (status !== 'met') unverified.push(requirement);
    } else if (!text.includes(norm(requirement))) unverified.push(requirement);
  }
  for (const exclusion of request.exclusions) {
    if (/breakfast/i.test(exclusion)) {
      if (/breakfast included|breakfast in the rate|with breakfast/i.test(text) && !/optional|add breakfast/i.test(text)) hardConflicts.push(`No ${exclusion}`);
      else if (!/room only|without breakfast|breakfast (?:is )?(?:not included|excluded)|excluding breakfast/i.test(text)) unverified.push(`No ${exclusion}`);
    } else if (text.includes(norm(exclusion))) hardConflicts.push(`No ${exclusion}`);
    else unverified.push(`No ${exclusion}`);
  }
  const softMatches = request.preferences.filter(preference => text.includes(norm(preference)));
  const softMisses = request.preferences.filter(preference => !softMatches.includes(preference));
  return { hardConflicts, unverified, softMatches, softMisses };
}

function candidateFor(element: PageElement, seen: Observation, request: SearchRequest): OfferCandidate {
  const context = element.context?.trim() || element.name;
  const money = priceOf(context, request);
  const key = createHash('sha256').update(norm(context + '|' + element.name)).digest('hex').slice(0, 16);
  const label = context.replace(/\s+/g, ' ').slice(0, 220);
  // A displayed amount is only a comparable stay price when the page establishes dates,
  // occupancy and a stay basis. Tax and extras may still be absent until checkout.
  const comparable = money.amount !== null && seen.text.includes(request.checkin) && seen.text.includes(request.checkout) &&
    !!request.adults && new RegExp(`\\b${request.adults}\\s*(?:adults?|guests?|people)\\b`, 'i').test(seen.text) &&
    money.priceBasis !== 'unknown';
  const classified = classify(context, request, money, comparable);
  return { key, observationId: seen.id, actionName: element.name, context, label, ...money, comparable, ...classified };
}

export function observedOffers(seen: Observation, request: SearchRequest): OfferCandidate[] {
  if (seen.blocked) return [];
  const elements = seen.elements.filter(element => !element.disabled && /^(?:select|choose|pick)(?:\s|$)/i.test(element.name) &&
    !!element.context && /€|£|\$|EUR|GBP|USD|rate|room/i.test(element.context));
  const byKey = new Map<string, OfferCandidate>();
  for (const element of elements) {
    const offer = candidateFor(element, seen, request);
    byKey.set(offer.key, offer);
  }
  return [...byKey.values()];
}

const comparableAmount = (a: OfferCandidate, b: OfferCandidate) => a.comparable && b.comparable && a.currency === b.currency && a.amount !== null && b.amount !== null;
export function rankOffers(offers: OfferCandidate[], mode: 'initial' | 'recovery', original?: OfferCandidate): OfferCandidate[] {
  return [...offers].sort((a, b) => {
    if (mode === 'initial') {
      const conflict = a.hardConflicts.length - b.hardConflicts.length;
      if (conflict) return conflict;
      const unknown = a.unverified.length - b.unverified.length;
      if (unknown) return unknown;
      const fit = b.softMatches.length - a.softMatches.length;
      if (fit) return fit;
    }
    if (mode === 'recovery' && original) {
      const aDistance = comparableAmount(a, original) ? Math.abs(a.amount! - original.amount!) : Infinity;
      const bDistance = comparableAmount(b, original) ? Math.abs(b.amount! - original.amount!) : Infinity;
      if (aDistance !== bDistance) return aDistance - bDistance;
    }
    if (comparableAmount(a, b)) return a.amount! - b.amount!;
    if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function eligible(offer: OfferCandidate): boolean { return offer.hardConflicts.length === 0 && offer.unverified.length === 0; }

export function offerLines(offer: OfferCandidate): string[] {
  // The short label is useful for ranking, but the traveller needs the complete
  // observed listing text to compare rate terms before selecting an option.
  return [offer.context.replace(/\s+/g, ' ').trim(), `Displayed price: ${offer.price || 'unknown'}${offer.comparable ? ` (${offer.priceBasis === 'night' ? 'nightly, converted to stay for ranking' : 'provisional stay price'})` : ' (basis unverified)'}`,
    'The full total, cancellation terms, payment timing and hotel payee are checked in the separate quote before agreement.',
    ...offer.hardConflicts.map(x => `Hard conflict: ${x}`), ...offer.unverified.map(x => `Unverified: ${x}`),
    ...offer.softMatches.map(x => `Preference match: ${x}`), ...offer.softMisses.map(x => `Preference not shown: ${x}`)];
}
