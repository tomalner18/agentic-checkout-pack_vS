// The shapes the chat and your agent share. Extend them freely: they are a
// starting point, not a contract.

/** The person chatting, from their Halcy profile (starter/traveller.json). */
export interface Traveller {
  first: string;
  last: string;
  email: string;
  phone: string;
}

export interface Button {
  id: string;
  label: string;
}

/** Listing facts are provisional until the separate checkout quote is checked. */
export interface RoomOptionDetails {
  name: string;
  priceLabel: string;
  price: string;
  priceNote: string;
  dates: string;
  guests: string;
  cancellation: string;
  meals: string;
  payment: string;
  paymentExpectation: 'nothing-now' | 'full-now' | 'unknown';
  alerts: string[];
  highlights: string[];
  listingText: string;
}

/** Something richer than a text bubble: a summary, a screenshot, a link, a choice. */
export interface Card {
  title: string;
  notice?: string;
  priceChange?: { beforeLabel: string; before: string; current: string; difference?: string };
  lines?: string[];
  roomOption?: RoomOptionDetails;
  /** A PNG (for example a screenshot) shown in the card. */
  image?: Buffer;
  link?: { label: string; url: string };
  buttons?: Button[];
}

export interface Chat {
  /** Send a text message to the traveller. */
  say(text: string): void;
  /** Show a card. Returns its id. */
  card(card: Card): string;
  /** Show a card with buttons and wait until the traveller presses one. Resolves to the button's id. */
  choose(card: Card & { buttons: Button[] }): Promise<string>;
  /** Present several actionable cards, with one selection across the group. */
  choices?(cards: (Card & { buttons: Button[] })[]): Promise<{ index: number; button: string }>;
  /** Revoke all outstanding card actions after a request or quote revision. */
  invalidate?(): void;
  /** Short progress label, cleared when work stops. */
  progress?(label: string | null): void;
  rememberRequest?(hotel: string, request: { checkin: string; checkout: string; adults: number | null; hardRequirements: string[]; preferences: string[]; exclusions: string[] }): void;
  rememberDraft?(draft: RequestDraft): void;
  setIntake?(active: boolean): void;
  takePending?(): string | undefined;
  privateQuote?(lines: string[] | null): void;
  outcomeUnknown?(): void;
  confirmed?(reference: string): void;
  /** Wait for the traveller's next message. */
  reply(): Promise<string>;
}

export interface Context {
  traveller: Traveller;
  /** ISO date (YYYY-MM-DD). */
  today: string;
  /** Hotel name to booking-site address (starter/hotels.json). Stands in for
   *  Halcy's places database: at the debrief we add a hotel your agent hasn't seen. */
  hotels: Record<string, string>;
  signal?: AbortSignal;
  revision?: number;
  priorRequest?: { checkin: string; checkout: string; adults: number | null; hardRequirements: string[]; preferences: string[]; exclusions: string[] };
  priorHotel?: string;
  draft?: RequestDraft;
}

export interface RankingPriority {
  kind: 'feature' | 'quality' | 'price';
  value: string;
}

export interface RequestDraft {
  hotelMention: string | null;
  hotel: string | null;
  checkin: string | null;
  checkout: string | null;
  adults: number | null;
  hardRequirements: string[];
  preferences: string[];
  exclusions: string[];
  rankingPriorities: RankingPriority[];
}

/** Runs once per new conversation turn: the traveller wrote `message` while the agent was idle. */
export type Agent = (message: string, chat: Chat, ctx: Context) => Promise<void>;
