import type { RankingPriority, RequestDraft } from './types.ts';

const str = { type: 'string' };
const strings = { type: 'array', items: str };
const priority = { type: 'object', properties: { kind: { type: 'string', enum: ['feature', 'quality', 'price'] }, value: str }, required: ['kind', 'value'], additionalProperties: false };

/** Empty strings and null adults mean "not supplied in this message". */
export const requestPatchSchema = {
  type: 'object',
  properties: {
    hotelMention: str, checkin: str, checkout: str, estimatedArrival: str,
    clearHotel: { type: 'boolean' }, clearCheckin: { type: 'boolean' }, clearCheckout: { type: 'boolean' }, clearAdults: { type: 'boolean' }, clearEstimatedArrival: { type: 'boolean' },
    adults: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    hardAdd: strings, hardRemove: strings,
    preferenceAdd: strings, preferenceRemove: strings,
    exclusionAdd: strings, exclusionRemove: strings,
    specialAdd: strings, specialRemove: strings,
    replaceRanking: { type: 'boolean' },
    rankingPriorities: { type: 'array', items: priority },
  },
  required: ['hotelMention', 'checkin', 'checkout', 'estimatedArrival', 'adults', 'clearHotel', 'clearCheckin', 'clearCheckout', 'clearAdults', 'clearEstimatedArrival', 'hardAdd', 'hardRemove', 'preferenceAdd', 'preferenceRemove', 'exclusionAdd', 'exclusionRemove', 'specialAdd', 'specialRemove', 'replaceRanking', 'rankingPriorities'],
  additionalProperties: false,
} as const;

export interface RequestPatch {
  hotelMention: string;
  checkin: string;
  checkout: string;
  estimatedArrival: string;
  adults: number | null;
  clearHotel: boolean;
  clearCheckin: boolean;
  clearCheckout: boolean;
  clearAdults: boolean;
  clearEstimatedArrival: boolean;
  hardAdd: string[];
  hardRemove: string[];
  preferenceAdd: string[];
  preferenceRemove: string[];
  exclusionAdd: string[];
  exclusionRemove: string[];
  specialAdd: string[];
  specialRemove: string[];
  replaceRanking: boolean;
  rankingPriorities: RankingPriority[];
}

/** Preserve explicit verbal ordering if the model omits a named fallback. */
export function completeVerbalPriorities(message: string, patch: RequestPatch, previous: RequestDraft): RequestPatch {
  const text = message.toLowerCase();
  const wantsQuality = /\bnicest\b|\bbest (?:room|option)\b/.test(text) && !/\bnot (?:the )?(?:nicest|best)\b/.test(text);
  const wantsPrice = /\bcheapest\b|\blowest price\b/.test(text) && !/\bnot (?:the )?cheapest\b/.test(text);
  if (!wantsQuality && !wantsPrice) return patch;
  const priorities = (patch.replaceRanking ? patch.rankingPriorities : previous.rankingPriorities).map(item => ({ ...item }));
  if (wantsQuality && /\botherwise\b/.test(text)) {
    for (const feature of patch.preferenceAdd) if (!priorities.some(item => item.kind === 'feature' && norm(item.value) === norm(feature))) {
      priorities.unshift({ kind: 'feature', value: feature });
    }
  }
  if (wantsQuality && !priorities.some(item => item.kind === 'quality')) priorities.push({ kind: 'quality', value: '' });
  if (wantsPrice && !priorities.some(item => item.kind === 'price')) {
    if (/\bcheapest first\b|\bprice first\b|\bprioriti[sz]e (?:the )?(?:cheapest|price)\b/.test(text)) priorities.unshift({ kind: 'price', value: '' });
    else priorities.push({ kind: 'price', value: '' });
  }
  return { ...patch, replaceRanking: true, rankingPriorities: priorities };
}

export const emptyDraft = (): RequestDraft => ({ hotelMention: null, hotel: null, checkin: null, checkout: null, adults: null,
  hardRequirements: [], preferences: [], exclusions: [], estimatedArrival: null, specialRequests: [], rankingPriorities: [] });

const norm = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const estimatedArrivalTime = (value: string): string | null => {
  const clock = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) return `${clock[1].padStart(2, '0')}:${clock[2]}`;
  const ampm = value.match(/\b(1[0-2]|0?[1-9])(?:\s*[:.]\s*([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!ampm) return null;
  const hour = Number(ampm[1]) % 12 + (/^p/i.test(ampm[3]) ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${ampm[2] || '00'}`;
};
const arrivalLogistics = (value: string) => /\b(?:arriv(?:e|al|ing)?|land(?:ing)?|flight|late\s+check[ -]?in|estimated\s+check[ -]?in)\b/i.test(value);
const guaranteedLateCheckin = (value: string) => /\b(?:must|need|require|guarantee|only if)\b/i.test(value) && /check[ -]?in/i.test(value);

/** Keep an arrival estimate out of room/rate filters even if intake labels it as a preference. */
export function normalizeArrivalPatch(message: string, patch: RequestPatch): RequestPatch {
  const estimate = patch.estimatedArrival.trim() || (arrivalLogistics(message) ? estimatedArrivalTime(message) || '' : '');
  const incidental = (value: string) => arrivalLogistics(value) && !guaranteedLateCheckin(value);
  const misplaced = [...patch.hardAdd, ...patch.preferenceAdd].filter(incidental);
  return { ...patch, estimatedArrival: estimate,
    hardAdd: patch.hardAdd.filter(value => !incidental(value)),
    preferenceAdd: patch.preferenceAdd.filter(value => !incidental(value)),
    specialAdd: [...patch.specialAdd, ...(!estimate ? misplaced : [])],
  };
}
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = current;
  }
  return previous[b.length];
}

export function hotelMatches(mention: string, hotels: Record<string, string>): { exact: string | null; suggestions: string[] } {
  const sought = norm(mention);
  if (!sought) return { exact: null, suggestions: [] };
  const names = Object.keys(hotels);
  const exact = names.find(name => norm(name) === sought || sought === `${norm(name)} hotel`) || null;
  if (exact) return { exact, suggestions: [] };
  const close = names.map(name => ({ name, distance: editDistance(sought, norm(name)) / Math.max(sought.length, norm(name).length) }))
    .filter(candidate => candidate.distance <= 0.4).sort((a, b) => a.distance - b.distance);
  return { exact: null, suggestions: close.slice(0, 3).map(candidate => candidate.name) };
}

function updateList(current: string[], add: string[], remove: string[]): string[] {
  const removals = new Set(remove.map(norm));
  const result = current.filter(value => !removals.has(norm(value)));
  for (const value of add.map(value => value.trim()).filter(Boolean)) if (!result.some(existing => norm(existing) === norm(value))) result.push(value);
  return result;
}

export function applyRequestPatch(previous: RequestDraft, patch: RequestPatch, today: string, hotels: Record<string, string>): RequestDraft {
  const draft: RequestDraft = { ...previous,
    estimatedArrival: previous.estimatedArrival || null,
    hardRequirements: updateList(previous.hardRequirements, patch.hardAdd, patch.hardRemove),
    preferences: updateList(previous.preferences, patch.preferenceAdd, patch.preferenceRemove),
    exclusions: updateList(previous.exclusions, patch.exclusionAdd, patch.exclusionRemove),
    specialRequests: updateList(previous.specialRequests || [], patch.specialAdd, patch.specialRemove),
    rankingPriorities: previous.rankingPriorities.map(item => ({ ...item })),
  };
  if (patch.clearHotel) { draft.hotelMention = null; draft.hotel = null; }
  if (patch.clearCheckin) draft.checkin = null;
  if (patch.clearCheckout) draft.checkout = null;
  if (patch.clearAdults) draft.adults = null;
  if (patch.clearEstimatedArrival) draft.estimatedArrival = null;
  if (patch.estimatedArrival) draft.estimatedArrival = estimatedArrivalTime(patch.estimatedArrival) || draft.estimatedArrival;
  if (patch.hotelMention.trim()) {
    draft.hotelMention = patch.hotelMention.trim();
    draft.hotel = hotelMatches(draft.hotelMention, hotels).exact;
  }
  if (patch.checkin && validDate(patch.checkin) && patch.checkin >= today) draft.checkin = patch.checkin;
  if (patch.checkout && validDate(patch.checkout) && patch.checkout > today) draft.checkout = patch.checkout;
  if (draft.checkin && draft.checkout && draft.checkout <= draft.checkin) {
    if (patch.checkin && !patch.checkout) draft.checkout = null;
    else if (patch.checkout && !patch.checkin) draft.checkin = null;
    else { draft.checkin = null; draft.checkout = null; }
  }
  if (patch.adults !== null && Number.isInteger(patch.adults) && patch.adults >= 1 && patch.adults <= 8) draft.adults = patch.adults;
  if (patch.replaceRanking) draft.rankingPriorities = patch.rankingPriorities
    .filter(item => item.kind !== 'feature' || !!item.value.trim())
    .map(item => ({ kind: item.kind, value: item.kind === 'feature' ? item.value.trim() : '' }));
  const removed = new Set(patch.preferenceRemove.map(norm));
  draft.rankingPriorities = draft.rankingPriorities.filter(item => item.kind !== 'feature' || !removed.has(norm(item.value)));
  return draft;
}
