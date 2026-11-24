// server/tests/fixtures/personal-mail-cases.ts
/**
 * Dummy mail for a family's personal Gmail (lane L1, docs/superpowers/specs/2026-11-21-personal-mail-rules-design.md).
 * Expectations were written from what a parent would want BEFORE any run or prompt change, and are
 * not to be bent to fit a model's output. Read by the filter's unit test (verdicts, no model) and by
 * the live eval (extraction on the Flock model).
 *
 * The family: Shiva Shankar (shiva.test@gmail.com, personal), Ankita (wife, ankita.test@gmail.com),
 * Agastya (8, Grade 3B, Greenwood High, greenwoodhigh.edu.in, MyClassBoard), Meera (4), Lakshmi (65).
 * Mail day: Tue 24 Nov 2026, Asia/Kolkata.
 */

export const MAIL_DAY = "2026-11-24";
export const SENT_AT = "2026-11-24T10:00:00+05:30";
export const OWNER_TZ = "Asia/Kolkata";
export const PERSONAL_MAILBOX = "shiva.test@gmail.com";
export const WORK_MAILBOX = "shiva@example.com";

export const FAMILY = {
  names: ["Shiva", "Shankar", "Ankita", "Agastya", "Meera", "Lakshmi"],
  addresses: ["shiva.test@gmail.com", "ankita.test@gmail.com"],
  schoolDomains: ["greenwoodhigh.edu.in", "myclassboard.com"],
};

/** What the user model says about the owner, as the extraction prompt's "About the user" line. */
export const ABOUT_USER =
  "About the user: Shiva Shankar, shiva.test@gmail.com. Lives in Bengaluru (Asia/Kolkata) with his wife Ankita, " +
  "son Agastya (8, Grade 3B at Greenwood High) and daughter Meera (4), and his mother Lakshmi (65).";

export type Audience = "family" | "personal";

/** The code filter's rule numbers (spec §1): 1 trusted sender, 2 keep subject, 3 sender role,
 *  4 no-reply, 5 status subject, 6 social, 7 bulk + no family name, 8 everything else → model. */
export type FilterRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ExpectedEvent { date: string; time?: string; audience: Audience }
export interface ExpectedTodo { act: RegExp; due?: string | null; high?: boolean; audience: Audience }

export interface MailCase {
  id: string;
  title: string;
  from: string;            // "Name <address>"
  to?: string;             // default: the personal mailbox
  subject: string;
  body: string;
  /** A real opt-out link in the mail (the harvest's bulk signal). */
  unsubscribe?: boolean;
  /** Default personal. W1 is the work control. */
  mailbox?: "personal" | "work";
  filter: { keep: boolean; rule: FilterRule };
  /** For kept mail. Absent on dropped mail. */
  expect?: {
    /** Each must reach the calendar (dated fact that passes the event gate) on this date (and time). Extras allowed. */
    events?: ExpectedEvent[];
    /** Exactly these to-dos (count must match). Empty array = no to-do at all. */
    todos?: ExpectedTodo[];
    /** No event may reach the calendar from this mail. */
    noEvents?: boolean;
  };
}

const UNSUB = "\n\n—\nYou are receiving this because you subscribed. Unsubscribe: https://lists.example.net/u/abc123";

export const CASES: MailCase[] = [
  // ── School ────────────────────────────────────────────────────────────────────────────────
  {
    id: "S1", title: "Annual Day circular with three asks",
    from: "Greenwood High <info@greenwoodhigh.edu.in>", subject: "Annual Day on 12 Dec: Grade 3 details", unsubscribe: true,
    body: "Dear Parents of Grade 3,\n\nOur Annual Day is on Saturday 12 December 2026 at 10:00 am in the school auditorium. Grade 3 performs the folk dance.\n\n1. Please send your child's costume (white kurta and pyjama) to school by Saturday 5 December.\n2. Pay Rs 300 towards props on MyClassBoard by Thursday 3 December.\n3. Sign the consent slip in the diary and return it by Friday 4 December.\n\nRegards,\nPrincipal" + UNSUB,
    filter: { keep: true, rule: 1 },
    expect: {
      events: [{ date: "2026-12-12", time: "10:00", audience: "family" }],
      todos: [
        { act: /costume/i, due: "2026-12-05", audience: "family" },
        { act: /pay|props|300/i, due: "2026-12-03", audience: "family" },
        { act: /consent|slip|sign/i, due: "2026-12-04", audience: "family" },
      ],
    },
  },
  {
    id: "S2", title: "PTM scheduled (no-reply portal mail)",
    from: "MyClassBoard <noreply@myclassboard.com>", subject: "PTM scheduled: Agastya Shankar",
    body: "Dear Parent, the Parent-Teacher Meeting for Agastya Shankar (Grade 3B) is scheduled on Saturday 5 December 2026, 9:30 am to 10:00 am, with the class teacher Mrs Riya Nair.",
    filter: { keep: true, rule: 1 },
    expect: { events: [{ date: "2026-12-05", time: "09:30", audience: "family" }], todos: [] },
  },
  {
    id: "S3", title: "Holiday list 2027",
    from: "Greenwood High <info@greenwoodhigh.edu.in>", subject: "School holiday list for 2027", unsubscribe: true,
    body: "Dear Parents, please find the holidays for January to March 2027:\n- 1 January 2027 (Friday): New Year\n- 14 January 2027 (Thursday): Sankranti\n- 26 January 2027 (Tuesday): Republic Day\n- 6 March 2027 (Saturday): Maha Shivaratri\nSchool remains closed on these days." + UNSUB,
    filter: { keep: true, rule: 1 },
    expect: { events: [{ date: "2027-01-14", audience: "family" }], todos: [] },
  },
  {
    id: "S4", title: "Class teacher's own Gmail: unit tests",
    from: "Riya Nair <riya.nair.teacher@gmail.com>", subject: "Unit test 2 next week",
    body: "Dear parents of 3B,\n\nUnit Test 2 is from Wednesday 2 December to Friday 4 December: Maths on 2 Dec, English on 3 Dec, EVS on 4 Dec. Agastya has been doing well in Maths, so please help him revise English.\n\nRiya Nair, Class teacher 3B",
    filter: { keep: true, rule: 8 },
    expect: { events: [{ date: "2026-12-02", audience: "family" }], todos: [] },
  },
  {
    id: "S5", title: "Term fee due with late fee",
    from: "MyClassBoard <noreply@myclassboard.com>", subject: "Term 3 fee due on 10 Dec",
    body: "Dear Parent of Agastya Shankar, the Term 3 fee of Rs 42,500 is due on Thursday 10 December 2026. A late fee of Rs 500 applies to payments after the due date. Pay on MyClassBoard.",
    filter: { keep: true, rule: 1 },
    // The due date lives on the to-do: extraction never makes a deadline into a calendar event (the event
    // gate refuses role "deadline"); the Family Calendar makes the deadline event from it (lane L3).
    expect: { todos: [{ act: /fee|pay/i, due: "2026-12-10", high: true, audience: "family" }] },
  },

  // ── Bills and banks ───────────────────────────────────────────────────────────────────────
  {
    id: "B1", title: "Card payment-due reminder from alerts@",
    from: "Axis Bank <alerts@axisbank.com>", subject: "Payment due reminder: credit card ending 4321",
    body: "Dear Shiva Shankar, the payment of Rs 18,240 for your Axis Bank credit card ending 4321 is due on 10 December 2026. Pay the total amount due to avoid interest and a late payment fee.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /pay|card/i, due: "2026-12-10", audience: "family" }] },
  },
  {
    id: "B2", title: "Debit alert", from: "HDFC Bank <alerts@hdfcbank.net>", subject: "Rs 450.00 debited from a/c **1234",
    body: "Dear Customer, Rs 450.00 has been debited from account **1234 to VPA swiggy@icici on 24-11-26. Not you? Call 18002586161.",
    filter: { keep: false, rule: 3 },
  },
  {
    id: "B3", title: "Card statement from a statements address",
    from: "HDFC Bank Credit Cards <emailstatements.cards@hdfcbank.net>", subject: "Your HDFC Bank Credit Card statement for November 2026",
    body: "Dear Shiva Shankar, your statement for the card ending 9876 is attached. Total amount due: Rs 12,340. Minimum amount due: Rs 620. Payment due date: 8 December 2026.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /pay|card|statement/i, due: "2026-12-08", audience: "family" }] },
  },
  {
    id: "B4", title: "Electricity bill", from: "BESCOM <ebill@bescom.co.in>", subject: "Electricity bill for November: Rs 2,140 due 15 Dec",
    body: "Dear Shiva Shankar, your electricity bill for account 7712345 for November is Rs 2,140. Please pay by 15 December 2026.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /pay|bill|electricity/i, due: "2026-12-15", audience: "family" }] },
  },
  {
    id: "B5", title: "Overdue bill, disconnection", from: "BESCOM <ebill@bescom.co.in>", subject: "Overdue: pay by 18 Dec to avoid disconnection",
    body: "Dear Shiva Shankar, Rs 1,980 from your October bill (account 7712345) is overdue. Pay by 18 December 2026 to avoid disconnection of supply.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /pay|bill|overdue/i, due: "2026-12-18", high: true, audience: "family" }] },
  },
  {
    id: "B6", title: "Card spend alert", from: "ICICI Bank <alerts@icicibank.com>", subject: "Transaction alert: INR 1,200 spent on your card",
    body: "INR 1,200.00 spent on ICICI Bank card XX4455 at DMART on 24-Nov-26. Avl limit INR 1,12,300.",
    filter: { keep: false, rule: 3 },
  },

  // ── Renewals, tax, government ─────────────────────────────────────────────────────────────
  {
    id: "R1", title: "Car insurance expiring", from: "ACKO <renewals@acko.com>", subject: "Your car insurance expires on 20 Dec: renew now",
    body: "Hi Shiva Shankar, the policy for your car KA-01-AB-1234 expires on 20 December 2026. Renew before then to stay covered and keep your no-claim bonus.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /renew|insurance/i, due: "2026-12-20", high: true, audience: "family" }] },
  },
  {
    id: "R2", title: "Insurer marketing", from: "ACKO <marketing@acko.com>", subject: "Get 20% off on health insurance this week", unsubscribe: true,
    body: "Protect your family with ACKO health insurance. Get 20% off when you buy this week. Use code HEALTH20." + UNSUB,
    filter: { keep: false, rule: 3 },
  },
  {
    id: "R3", title: "Passport expiry", from: "Passport Seva <no-reply@passportindia.gov.in>", subject: "Passport expiry reminder",
    body: "Dear Shiva Shankar, your passport Z1234567 expires on 15 March 2027. Apply for re-issue in time.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /passport|re-?issue|renew/i, audience: "personal" }] },
  },
  {
    id: "R4", title: "Tax demand", from: "Income Tax Department <noreply@incometax.gov.in>", subject: "Outstanding tax demand: respond by 30 Dec",
    body: "Dear Shiva Shankar (PAN ABCPS1234K), an outstanding demand of Rs 8,410 is pending for AY 2025-26. Respond on the e-filing portal by 30 December 2026: agree and pay, or disagree with reasons.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /respond|tax|demand/i, due: "2026-12-30", high: true, audience: "personal" }] },
  },
  {
    id: "R5", title: "ITR acknowledgement", from: "Income Tax Department <noreply@incometax.gov.in>", subject: "ITR filed: acknowledgement for AY 2026-27",
    body: "Dear Shiva Shankar, your Income Tax Return for AY 2026-27 was filed successfully on 24 November 2026. Acknowledgement number 123456789012345.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [] },
  },
  {
    id: "R6", title: "KYC update", from: "ICICI Bank <service@icicibank.com>", subject: "Update your KYC by 31 Dec",
    body: "Dear Shiva Shankar, as per RBI rules your KYC for savings account **5521 must be updated by 31 December 2026, or the account will be frozen for transactions. Update it on iMobile or at any branch.",
    filter: { keep: true, rule: 8 },
    expect: { todos: [{ act: /kyc/i, due: "2026-12-31", high: true, audience: "personal" }] },
  },

  // ── Appointments ──────────────────────────────────────────────────────────────────────────
  {
    id: "A1", title: "Doctor appointment confirmed", from: "Practo <noreply@practo.com>", subject: "Appointment confirmed with Dr Rao",
    body: "Your appointment with Dr Sunita Rao (Paediatrician, Cloudnine Jayanagar) for Meera is confirmed for Saturday 5 December 2026 at 11:00 am.",
    filter: { keep: true, rule: 2 },
    expect: { events: [{ date: "2026-12-05", time: "11:00", audience: "family" }], todos: [] },
  },
  {
    id: "A2", title: "Vaccination due", from: "Cloudnine Hospital <care@cloudninecare.com>", subject: "Meera's vaccination is due on 12 Dec",
    body: "Dear Parent, Meera's MMR second dose is due on 12 December 2026. Please book an appointment with your paediatrician before then.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /book|vaccin|appointment/i, due: "2026-12-12", audience: "family" }] },
  },

  // ── Bookings ──────────────────────────────────────────────────────────────────────────────
  {
    id: "K1", title: "Family flight e-ticket", from: "IndiGo <no-reply@goindigo.in>", subject: "Your e-ticket: 6E-512 BLR-MAA, 22 Dec",
    body: "Booking confirmed. PNR Q8X2LP.\nFlight 6E-512, Bengaluru (BLR) to Chennai (MAA), Tuesday 22 December 2026, departs 06:10.\nPassengers: Shiva Shankar, Ankita Shankar, Agastya Shankar, Meera Shankar.",
    filter: { keep: true, rule: 2 },
    expect: { events: [{ date: "2026-12-22", time: "06:10", audience: "family" }] },
  },
  {
    id: "K2", title: "Movie tickets for two", from: "BookMyShow <tickets@bookmyshow.com>", subject: "Your tickets: Moana 2",
    body: "Booking ID WXYZ1234. Moana 2 (U), PVR Forum Mall, Koramangala. Saturday 28 November 2026, 7:00 pm. 2 tickets: J7, J8.",
    filter: { keep: true, rule: 2 },
    expect: { events: [{ date: "2026-11-28", time: "19:00", audience: "family" }], todos: [] },
  },
  {
    id: "K3", title: "Salon booking for Shiva", from: "Urban Company <bookings@urbancompany.com>", subject: "Booking confirmed: haircut for Shiva",
    body: "Your booking is confirmed. Men's haircut for Shiva, Sunday 29 November 2026 at 11:00 am, at home. Professional: Imran.",
    filter: { keep: true, rule: 2 },
    expect: { events: [{ date: "2026-11-29", time: "11:00", audience: "personal" }], todos: [] },
  },

  // ── Deliveries and commerce ───────────────────────────────────────────────────────────────
  {
    id: "D1", title: "Out for delivery", from: "Amazon.in <shipment-tracking@amazon.in>", subject: "Out for delivery: your order of Lego Classic",
    body: "Hello Shiva, your package with Lego Classic Bricks is out for delivery today.", unsubscribe: true,
    filter: { keep: false, rule: 5 },
  },
  {
    id: "D2", title: "Collect from locker", from: "Amazon.in <shipment-tracking@amazon.in>", subject: "Collect your parcel from the Amazon Locker by 25 Nov", unsubscribe: true,
    body: "Hello Shiva, your parcel is waiting at Amazon Locker - Forum Mall. Collect it by Wednesday 25 November 2026 with code 448812, or it will be returned." + UNSUB,
    filter: { keep: true, rule: 8 },
    expect: { todos: [{ act: /collect|parcel|locker/i, due: "2026-11-25", audience: "personal" }] },
  },
  {
    id: "D3", title: "Food delivered", from: "Swiggy <noreply@swiggy.in>", subject: "Your order has been delivered",
    body: "Your order from Meghana Foods has been delivered. Rate your order.", filter: { keep: false, rule: 4 },
  },
  {
    id: "D4", title: "Grocery offer", from: "Zepto <hello@zepto.com>", subject: "Flat 50% off on fruits today", unsubscribe: true,
    body: "Flat 50% off on fruits, today only. Order now." + UNSUB, filter: { keep: false, rule: 3 },
  },

  // ── Housing society ───────────────────────────────────────────────────────────────────────
  {
    id: "Y1", title: "Society maintenance due", from: "Prakash Rao (Secretary) <prestige-residents@googlegroups.com>", subject: "Q3 maintenance due by 10 Dec", unsubscribe: true,
    body: "Dear residents, Q3 maintenance of Rs 9,600 per flat is due by 10 December 2026. Pay to the association account or on MyGate. A 2% late charge applies after that.\n\nPrakash Rao, Secretary" + UNSUB,
    filter: { keep: true, rule: 2 },
    expect: { todos: [{ act: /maintenance|pay/i, due: "2026-12-10", audience: "family" }] },
  },
  {
    id: "Y2", title: "Society photos", from: "Prakash Rao (Secretary) <prestige-residents@googlegroups.com>", subject: "Diwali photos from the clubhouse", unsubscribe: true,
    body: "Dear residents, thank you all for a lovely Diwali evening! Photos are in the shared album. See you at the next event." + UNSUB,
    filter: { keep: false, rule: 7 },
  },

  // ── Noise ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "N1", title: "Instagram notification", from: "Instagram <no-reply@mail.instagram.com>", subject: "ankita_s posted a photo",
    body: "ankita_s shared a new photo. See it on Instagram.", unsubscribe: true, filter: { keep: false, rule: 4 },
  },
  {
    id: "N2", title: "LinkedIn notification", from: "LinkedIn <notifications@linkedin.com>", subject: "You appeared in 5 searches this week",
    body: "Shiva, you appeared in 5 searches this week. See who's looking.", unsubscribe: true, filter: { keep: false, rule: 3 },
  },
  {
    id: "N3", title: "Fashion sale", from: "Myntra <offers@myntra.com>", subject: "End of season sale: up to 70% off", unsubscribe: true,
    body: "Up to 70% off on top brands. Sale ends Sunday." + UNSUB, filter: { keep: false, rule: 3 },
  },
  {
    id: "N4", title: "Fund house newsletter", from: "Vikram Mehta <research@fundhouse.in>", subject: "Market outlook for December", unsubscribe: true,
    body: "Markets ended November on a strong note. Here is what we expect in December and the themes we like." + UNSUB,
    filter: { keep: false, rule: 7 },
  },
  {
    id: "N5", title: "OTP", from: "Paytm <otp@paytm.com>", subject: "Your OTP is 482913",
    body: "482913 is your one time password. Do not share it with anyone.", filter: { keep: false, rule: 5 },
  },

  // ── People ────────────────────────────────────────────────────────────────────────────────
  {
    id: "P1", title: "Wife asks to book swimming", from: "Ankita Shankar <ankita.test@gmail.com>", subject: "Meera's swimming",
    body: "Hi, can you book Meera's swimming classes at the Aquatic Centre for Saturdays, 8 to 9 am? The new batch starts on Saturday 5 December. Bookings close on Friday.",
    filter: { keep: true, rule: 1 },
    expect: { todos: [{ act: /book|swim/i, audience: "family" }] },
  },
  {
    id: "P2", title: "Friend's dinner invite", from: "Rahul K <rahul.k@gmail.com>", subject: "Dinner on Friday?",
    body: "Hey Shiva, a few of us are meeting at Toit on Friday 27 November at 8 pm. You in?",
    filter: { keep: true, rule: 8 },
    expect: { todos: [] },
  },
  {
    id: "P3", title: "Recruiter cold mail", from: "Talent Team <talent@somestartup.io>", subject: "Exciting leadership role at SomeStartup",
    body: "Hi Shiva, I came across your profile and think you'd be a great fit for our VP Engineering role. Would you be open to a quick chat?",
    filter: { keep: true, rule: 8 },
    expect: { todos: [], noEvents: true },
  },
  {
    id: "I1", title: "Invitation accepted", from: "Google Calendar <calendar-notification@google.com>", subject: "Invitation accepted: Agastya's birthday party @ Sun 6 Dec 2026 4pm",
    body: "Priya Menon has accepted this invitation. Agastya's birthday party, Sunday 6 December 2026, 4pm to 7pm, at home.",
    filter: { keep: true, rule: 2 },
    expect: { todos: [] },
  },

  // ── Work control ──────────────────────────────────────────────────────────────────────────
  {
    id: "W1", title: "S1's circular to a work mailbox (control)", mailbox: "work", to: "Shiva Shankar <shiva@example.com>",
    from: "Greenwood High <info@greenwoodhigh.edu.in>", subject: "Annual Day on 12 Dec: Grade 3 details", unsubscribe: true,
    body: "Dear Parents of Grade 3,\n\nOur Annual Day is on Saturday 12 December 2026 at 10:00 am in the school auditorium. Grade 3 performs the folk dance.\n\n1. Please send your child's costume (white kurta and pyjama) to school by Saturday 5 December.\n2. Pay Rs 300 towards props on MyClassBoard by Thursday 3 December.\n3. Sign the consent slip in the diary and return it by Friday 4 December.\n\nRegards,\nPrincipal" + UNSUB,
    filter: { keep: true, rule: 8 },
  },
];
