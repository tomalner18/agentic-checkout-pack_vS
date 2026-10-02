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

/** Something richer than a text bubble: a summary, a screenshot, a link, a choice. */
export interface Card {
  title: string;
  lines?: string[];
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
}

/** Runs once per new conversation turn: the traveller wrote `message` while the agent was idle. */
export type Agent = (message: string, chat: Chat, ctx: Context) => Promise<void>;
