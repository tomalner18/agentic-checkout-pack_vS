export type BudgetStatus = 'met' | 'conflict' | 'unverified';
export type PriceBasis = 'stay' | 'night' | 'unknown';

const token = /(?:€|£|\$|EUR|GBP|USD)\s?\d[\d,.]*/i;

export function parseCurrencyAmount(value: string): { currency: string; amount: number } | null {
  const found = value.match(token)?.[0];
  if (!found) return null;
  const symbol = found.match(/€|£|\$|EUR|GBP|USD/i)?.[0].toUpperCase() || '';
  const currency = { '€': 'EUR', '£': 'GBP', '$': 'USD' }[symbol] || symbol;
  let digits = found.slice(symbol.length).trim();
  const comma = digits.lastIndexOf(',');
  const dot = digits.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    digits = digits.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? ',' : '.';
    const at = Math.max(comma, dot);
    digits = digits.length - at - 1 === 2 ? digits.replace(separator, '.') : digits.split(separator).join('');
  }
  const amount = Number(digits);
  return Number.isFinite(amount) ? { currency, amount } : null;
}

export function stayNights(checkin: string, checkout: string): number | null {
  const days = (Date.parse(checkout) - Date.parse(checkin)) / 86_400_000;
  return Number.isInteger(days) && days > 0 ? days : null;
}

export function budgetStatus(requirement: string, price: { currency: string | null; stayAmount: number | null; nights: number | null; complete: boolean }): BudgetStatus | null {
  if (!/\b(?:maximum|max|budget|under|below|up to)\b/i.test(requirement)) return null;
  const limit = parseCurrencyAmount(requirement);
  if (!limit || !price.currency || price.currency !== limit.currency || price.stayAmount === null || !price.nights) return 'unverified';
  const actual = /(?:per\s*night|\/\s*night|nightly)/i.test(requirement) ? price.stayAmount / price.nights : price.stayAmount;
  const strict = /\b(?:under|below)\b/i.test(requirement);
  if (strict ? actual >= limit.amount : actual > limit.amount) return 'conflict';
  return price.complete ? 'met' : 'unverified';
}
