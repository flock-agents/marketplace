// server/src/email-desk/personal-mail-rules.ts
//
// THE PERSONAL-MAILBOX FILTER (owner, 2026-11-21; docs/superpowers/specs/2026-11-21-personal-mail-rules-design.md §1).
// A family's Gmail is mostly machine mail: card alerts, order updates, offers, social notifications. Every
// one of those that reaches extraction costs a model call and risks a wrong to-do, so a personal mailbox
// gets a code filter that decides BEFORE any model sees the mail. Work mailboxes never come here: their
// filter is memory-eligibility.ts's, unchanged.
//
// The rules run in a fixed order and the FIRST match decides (the order is the owner's, and it matters:
// "Payment due" from alerts@axisbank.com is kept because rule 2 runs before rule 3):
//   1 keep  the sender is the family's school or a family member
//   2 keep  the subject is about something owed or official (KEEP_SUBJECT)
//   3 drop  the sender's address is a role like alerts@ or hello@ (SENDER_DROP_TOKENS)
//   4 drop  a no-reply sender
//   5 drop  a transaction or order-status subject (DROP_SUBJECT)
//   6 drop  a social network (SOCIAL_DOMAINS)
//   7 drop  bulk mail (an opt-out link) that names nobody in the family
//   8 keep  everything else goes to the model
// Banks and insurers get no rule of their own (owner): their bills pass by subject, their alerts drop.
//
// Pure: plain lists and string tests, no DB, no network, no model. Every verdict carries a reason code so
// a wrong drop can be traced to the rule that made it.

export type PersonalRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface PersonalVerdict {
  keep: boolean;
  rule: PersonalRule;
  reason:
    | "personal_trusted_sender"
    | "personal_keep_subject"
    | "personal_sender_role"
    | "personal_no_reply"
    | "personal_status_subject"
    | "personal_social"
    | "bulk_impersonal"
    | "personal_to_model";
}

/** What the filter needs to know about the family. Each list may be empty: the rules that read it then never match. */
export interface FamilyContext {
  /** First names (and surnames) of everyone in the household, children included. */
  names: readonly string[];
  /** Family members' email addresses. */
  addresses: readonly string[];
  /** Domains the children's school writes from (its own, its portal's). */
  schoolDomains: readonly string[];
}

export interface PersonalMail {
  /** The sender's address. */
  from: string;
  subject: string;
  /** The text the model would read: used only for rule 7's names test. */
  text: string;
  /** An opt-out link was found (the harvest's bulk signal). */
  bulk: boolean;
}

/** Plain Gmail is a personal mailbox; any other domain, a Google Workspace one included, is work (owner, 2026-11-21).
 *  Other consumer mail services get the rule when Flock has connectors for them. */
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function isPersonalMailbox(address: string | null | undefined): boolean {
  const a = (address ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  return at > 0 && PERSONAL_DOMAINS.has(a.slice(at + 1));
}

/** Rule 2. Something owed, due, booked or official. Matched as whole words or phrases, case-insensitive. */
export const KEEP_SUBJECT: readonly string[] = [
  "due", "overdue", "due date", "payment due", "statement", "renewal", "renew", "premium", "expiring", "expires", "expiry",
  "tax", "itr", "tds", "invitation accepted", "accepted your invitation",
  "appointment", "booking", "booked", "e-ticket", "ticket", "tickets", "pnr", "reservation", "check-in",
];

/** Rule 3. A role address: any of these as one token of the local part (split on . _ - + and digits). */
export const SENDER_DROP_TOKENS: readonly string[] = [
  "alert", "alerts", "notification", "notifications", "notify", "hello", "newsletter", "newsletters",
  "offer", "offers", "promo", "promotions", "marketing",
];

/** Rule 4. No-reply local parts, compared with the separators taken out. */
const NO_REPLY = new Set(["noreply", "donotreply"]);

/** Rule 5. A transaction or order-status subject. */
export const DROP_SUBJECT: readonly string[] = [
  "debited", "credited", "spent", "transaction", "otp", "one time password",
  "ordered", "order placed", "order confirmed", "shipped", "out for delivery", "delivered", "dispatched",
];

/** Rule 6. Social networks, matched on the sender's domain or any parent of it (mail.instagram.com). */
export const SOCIAL_DOMAINS: readonly string[] = [
  "facebookmail.com", "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "pinterest.com", "quora.com",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One regex per list: whole words, so "due" never matches "overdue"'s neighbour words wrongly and "tax" not "taxi". */
const wordsRe = (words: readonly string[]) => new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");
const KEEP_SUBJECT_RE = wordsRe(KEEP_SUBJECT);
const DROP_SUBJECT_RE = wordsRe(DROP_SUBJECT);
const DROP_TOKENS = new Set(SENDER_DROP_TOKENS);

function parts(address: string): { local: string; domain: string } {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  return at < 0 ? { local: a, domain: "" } : { local: a.slice(0, at), domain: a.slice(at + 1) };
}

/** `domain` is `root` or a subdomain of it. */
const underDomain = (domain: string, root: string) => {
  const r = root.trim().toLowerCase();
  return !!r && (domain === r || domain.endsWith(`.${r}`));
};

function namesSomeone(text: string, names: readonly string[]): boolean {
  return names.some((n) => n.trim().length > 1 && wordsRe([n.trim()]).test(text));
}

/** The verdict for one mail on a personal mailbox. Fails open: an unreadable sender only skips the sender rules. */
export function personalVerdict(mail: PersonalMail, family: FamilyContext): PersonalVerdict {
  const { local, domain } = parts(mail.from ?? "");
  const from = `${local}@${domain}`;
  const subject = mail.subject ?? "";

  if (domain && (family.addresses.some((a) => a.trim().toLowerCase() === from) || family.schoolDomains.some((d) => underDomain(domain, d)))) {
    return { keep: true, rule: 1, reason: "personal_trusted_sender" };
  }
  if (KEEP_SUBJECT_RE.test(subject)) return { keep: true, rule: 2, reason: "personal_keep_subject" };
  if (local && local.split(/[._\-+0-9]+/).some((t) => DROP_TOKENS.has(t))) return { keep: false, rule: 3, reason: "personal_sender_role" };
  if (local && NO_REPLY.has(local.replace(/[._\-+]/g, ""))) return { keep: false, rule: 4, reason: "personal_no_reply" };
  if (DROP_SUBJECT_RE.test(subject)) return { keep: false, rule: 5, reason: "personal_status_subject" };
  if (domain && SOCIAL_DOMAINS.some((d) => underDomain(domain, d))) return { keep: false, rule: 6, reason: "personal_social" };
  // Fails open like today's bulk test: with no names to check, the mail is kept.
  if (mail.bulk && family.names.length > 0 && !namesSomeone(mail.text ?? "", family.names)) {
    return { keep: false, rule: 7, reason: "bulk_impersonal" };
  }
  return { keep: true, rule: 8, reason: "personal_to_model" };
}
