import { createHash } from 'node:crypto';
import type { Observation, PageElement } from './browser.ts';
import { budgetStatus, parseCurrencyAmount, stayNights, type PriceBasis } from './budget.ts';
import type { RankingPriority, RoomOptionDetails } from './types.ts';

export interface SearchRequest {
  checkin: string;
  checkout: string;
  adults: number | null;
  hardRequirements: string[];
  preferences: string[];
  exclusions: string[];
  rankingPriorities?: RankingPriority[];
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
  qualityScore: number | null;
  qualityEvidence: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
const roomNameKey = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+rooms?$/, '').trim();

export function roomNamesEquivalent(requested: string, observed: string): boolean {
  const wanted = roomNameKey(requested);
  return !!wanted && wanted === roomNameKey(observed);
}

export function roomNameFromContext(context: string): string {
  return context.replace(/\s+/g, ' ').trim().split(/\s+[·•|—–]\s+|\.\s+|,\s+/)[0]
    .replace(/^(?:select|choose|pick)\s+/i, '').replace(/\s+\d{1,3}\s*(?:m²|sqm|sq\.?\s?m).*$/i, '').slice(0, 90);
}
function featureMatch(context: string, preference: string): boolean {
  const text = norm(context);
  const feature = norm(preference.replace(/\s+if available$/i, ''));
  if (!feature) return false;
  const candidatePhrases = feature === 'river view' ? [feature, 'river facing', 'river front', 'river side'] : [feature];
  return candidatePhrases.some(phrase => {
    let index = text.indexOf(phrase);
    while (index >= 0) {
      const prefix = text.slice(Math.max(0, index - 28), index);
      if (!/\b(?:no|without|lacks?|not offering)\s+(?:\w+\s+){0,2}$/.test(prefix)) return true;
      index = text.indexOf(phrase, index + phrase.length);
    }
    return false;
  });
}

function qualityOf(context: string): { score: number | null; evidence: string[] } {
  const tier = context.match(/\b(?:presidential suite|suite|deluxe|premium|executive|superior|classic|standard)\b/i)?.[0];
  const area = context.match(/\b(\d{2,3})\s*(?:m²|sqm|sq\.?\s?m)\b/i);
  const amenities = [...context.matchAll(/\b(?:balcony|terrace|jacuzzi|separate living area)\b/gi)]
    .filter(match => !/\b(?:no|without|lacks?)\s+(?:\w+\s+){0,2}$/i.test(context.slice(Math.max(0, (match.index || 0) - 28), match.index)))
    .map(match => match[0]);
  const tiers: Record<string, number> = { 'presidential suite': 8, suite: 7, deluxe: 5, premium: 4, executive: 4, superior: 3, classic: 2, standard: 1 };
  const evidence = [...(tier ? [tier] : []), ...(area ? [area[0]] : []), ...amenities];
  if (!evidence.length) return { score: null, evidence };
  return { score: (tier ? tiers[tier.toLowerCase()] * 1000 : 0) + (area ? Number(area[1]) : 0) + amenities.length * 5, evidence };
}
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
    } else if (/\brooms?\s*$/i.test(requirement)) {
      if (!roomNamesEquivalent(requirement, roomNameFromContext(context))) unverified.push(requirement);
    } else if (!text.includes(norm(requirement))) unverified.push(requirement);
  }
  for (const exclusion of request.exclusions) {
    if (/breakfast/i.test(exclusion)) {
      if (/breakfast included|breakfast in the rate|with breakfast/i.test(text) && !/optional|add breakfast/i.test(text)) hardConflicts.push(`No ${exclusion}`);
      else if (!/room only|without breakfast|breakfast (?:is )?(?:not included|excluded)|excluding breakfast/i.test(text)) unverified.push(`No ${exclusion}`);
    } else if (text.includes(norm(exclusion))) hardConflicts.push(`No ${exclusion}`);
    else unverified.push(`No ${exclusion}`);
  }
  const softMatches = request.preferences.filter(preference => featureMatch(context, preference));
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
  const quality = qualityOf(context);
  return { key, observationId: seen.id, actionName: element.name, context, label, ...money, comparable, ...classified,
    qualityScore: quality.score, qualityEvidence: quality.evidence };
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
export function rankOffers(offers: OfferCandidate[], mode: 'initial' | 'recovery', original?: OfferCandidate, request?: SearchRequest): OfferCandidate[] {
  return [...offers].sort((a, b) => {
    const conflict = a.hardConflicts.length - b.hardConflicts.length;
    if (conflict) return conflict;
    const unknown = a.unverified.length - b.unverified.length;
    if (unknown) return unknown;
    for (const priority of request?.rankingPriorities || []) {
      if (priority.kind === 'feature') {
        const fit = Number(featureMatch(b.context, priority.value)) - Number(featureMatch(a.context, priority.value));
        if (fit) return fit;
      } else if (priority.kind === 'quality') {
        if (a.qualityScore !== null && b.qualityScore !== null && a.qualityScore !== b.qualityScore) return b.qualityScore - a.qualityScore;
        if ((a.qualityScore !== null) !== (b.qualityScore !== null)) return a.qualityScore !== null ? -1 : 1;
      } else if (priority.kind === 'price') {
        if (comparableAmount(a, b) && a.amount !== b.amount) return a.amount! - b.amount!;
        if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
      }
    }
    if (mode === 'initial') {
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

function shortStayDates(checkin: string, checkout: string): string {
  const start = new Date(`${checkin}T00:00:00Z`);
  const end = new Date(`${checkout}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${checkin} – ${checkout}`;
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'UTC' });
  return month.format(start) === month.format(end) && year.format(start) === year.format(end)
    ? `${day.format(start)}–${day.format(end)} ${month.format(end)} ${year.format(end)}`
    : year.format(start) === year.format(end)
      ? `${day.format(start)} ${month.format(start)} – ${day.format(end)} ${month.format(end)} ${year.format(end)}`
      : `${day.format(start)} ${month.format(start)} ${year.format(start)} – ${day.format(end)} ${month.format(end)} ${year.format(end)}`;
}

/** A compact, evidence-bound display model for a listing. Checkout owns the final quote. */
export function roomOptionDetails(offer: OfferCandidate, request: SearchRequest): RoomOptionDetails {
  const context = offer.context.replace(/\s+/g, ' ').trim();
  const name = roomNameFromContext(context) || 'Room and rate';
  const cancellation = context.match(/free cancellation[^.!?]*(?:\.|$)/i)?.[0]?.trim() ||
    (/(?:non[ -]?refundable|not refundable|no refunds?)/i.test(context) ? 'Non-refundable rate shown' :
      /(?:fully )?refundable/i.test(context) ? 'Refundable rate shown; deadline to verify' : 'Cancellation terms not stated');
  const meals = /(?:breakfast included|breakfast in the rate|with breakfast)/i.test(context) ? 'Breakfast included' :
    /(?:room only|without breakfast|breakfast (?:is )?(?:not included|excluded))/i.test(context) ? 'Room only (no meals)' :
      /breakfast.{0,24}(?:extra|additional|optional)/i.test(context) ? 'Breakfast available for extra charge' : 'Meals not stated';
  const nothingNow = /(?:nothing|no(?:thing)?)\s+is\s+charged\s+now|pay\s+nothing\s+now/i.test(context);
  const payAtHotel = /pay\s+(?:at\s+the\s+hotel|at\s+hotel|on\s+arrival)/i.test(context);
  const chargedNow = /(?:full amount|total|price)\s+is\s+charged\s+now/i.test(context);
  const symbol = offer.currency === 'EUR' ? '€' : offer.currency === 'GBP' ? '£' : offer.currency === 'USD' ? '$' : offer.currency || '';
  const completeStay = offer.comparable && offer.priceBasis === 'stay' && offer.priceComplete && offer.amount !== null;
  const shownStay = offer.comparable && offer.amount !== null && offer.currency ? `${symbol}${offer.amount.toFixed(2)}` : offer.price || 'Not shown';
  const priceLabel = completeStay ? 'Listed total incl. tax' : offer.comparable && offer.priceBasis === 'night' ? 'Estimated stay price' :
    offer.comparable ? 'Listed stay price' : 'Listed price';
  const priceNote = completeStay ? 'Final total rechecked at checkout.' :
    offer.comparable && offer.priceBasis === 'night' ? 'From nightly rate · taxes and final total at checkout.' :
      offer.comparable ? 'Taxes and final total verified at checkout.' :
        'Stay basis, taxes and final total verified at checkout.';
  return {
    name, priceLabel, price: shownStay, priceNote,
    dates: shortStayDates(request.checkin, request.checkout),
    guests: request.adults ? `${request.adults} ${request.adults === 1 ? 'adult' : 'adults'}` : 'Guests not set',
    cancellation, meals,
    payment: nothingNow && payAtHotel ? 'Nothing charged now; pay at the hotel (amount verified at checkout).' :
      nothingNow ? 'Nothing charged now; later payment to verify at checkout.' :
        payAtHotel ? 'Pay at the hotel indicated; any charge now to verify at checkout.' :
          chargedNow ? 'Full amount charged now; any later charges to verify at checkout.' : 'Payment timing verified at checkout.',
    paymentExpectation: nothingNow ? 'nothing-now' : chargedNow ? 'full-now' : 'unknown',
    alerts: [...(!offer.comparable ? ['Dates and guests not verified for this rate'] : []),
      ...offer.hardConflicts.map(x => `Conflict: ${x}`), ...offer.unverified.map(x => `Unverified: ${x}`)],
    highlights: [...offer.softMatches.map(x => `Matches ${x}`), ...offer.qualityEvidence.filter(value => !name.toLowerCase().includes(value.toLowerCase())).slice(0, 2)],
    listingText: context,
  };
}

export function offerLines(offer: OfferCandidate, request?: SearchRequest): string[] {
  // The short label is useful for ranking, but the traveller needs the complete
  // observed listing text to compare rate terms before selecting an option.
  return [offer.context.replace(/\s+/g, ' ').trim(), `Displayed price: ${offer.price || 'unknown'}${offer.comparable ? ` (${offer.priceBasis === 'night' ? 'nightly, converted to stay for ranking' : 'provisional stay price'})` : ' (basis unverified)'}`,
    'The full total, cancellation terms, payment timing and hotel payee are checked in the separate quote before agreement.',
    ...offer.hardConflicts.map(x => `Hard conflict: ${x}`), ...offer.unverified.map(x => `Unverified: ${x}`),
    ...offer.softMatches.map(x => `Preference match: ${x}`), ...offer.softMisses.map(x => `Preference not shown: ${x}`),
    ...(request?.rankingPriorities?.some(priority => priority.kind === 'quality') ? [offer.qualityEvidence.length ? `Visible quality cues: ${offer.qualityEvidence.join(', ')}` : 'Quality comparison: no visible room tier or feature evidence'] : [])];
}
