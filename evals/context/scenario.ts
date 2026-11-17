/**
 * The brainstorm the context eval runs (task 3.13), with what to look for.
 *
 * - Pollution: in the "Notification channel" thread the person rejects
 *   WhatsApp. The "Escalation" section's draft, a sibling's, should never
 *   mention it: it was decided in another section's discussion.
 * - Sufficiency: the "Escalation email" draft, a child of "Escalation",
 *   should keep three constraints that live in decided text: one in the
 *   title's own text, one in the first line of a section further away, and
 *   one deeper in that section, past its first line.
 *
 * Checks are plain text matches, so a run is scored without a model.
 */

export const DOC = `# Failed-payment notifications

Every message we send ends with the client's account number.

## Notification channel

Sign every message as "The Billing Team".

Every email's subject line starts with "[Action needed]".

We send email first, then an in-app banner after 24 hours.

## Escalation

When a client hasn't paid 48 hours after a failed payment, we escalate.

### Escalation email

(To be written.)

## Success metric

Recovered revenue per month.
`;

export const FILE = "notifications.md";

/** The discussion in the "Notification channel" thread, as the person's turns. */
export const CHANNEL_THREAD = [
  "Should we also send a WhatsApp message on day 2, for clients who don't open email? Two sentences.",
  "No. We're rejecting WhatsApp: legal says customer-data rules rule it out. Don't use WhatsApp anywhere. Reply OK.",
];

export const ESCALATION_ASK =
  "Draft this section's text: what happens at each step when a client still hasn't paid. Under 120 words. Reply with the section's text only.";

export const EMAIL_ASK =
  "Write the escalation email itself: its subject line, then its body. Under 120 words. Reply with the email only.";

/** An option rejected in another section's thread, mentioned in a sibling's draft. */
export const leaks = (escalationDraft: string) => /whats\s*app/i.test(escalationDraft);

/** Each constraint from decided text, kept in the child's draft. */
export const CONSTRAINTS = [
  {
    name: "Title's own text: ends with the account number",
    kept: (d: string) => /account number/i.test(d),
  },
  {
    name: "Further away, first line: signed The Billing Team",
    kept: (d: string) => /billing team/i.test(d),
  },
  {
    name: "Further away, past the first line: subject starts [Action needed]",
    kept: (d: string) => /\[action needed\]/i.test(d),
  },
];
