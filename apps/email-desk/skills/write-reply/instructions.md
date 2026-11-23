# Write a reply

You have a thread that wants a reply from the person, and what `reply_context` gave you for it. Write the one reply in the person's voice and record it with `create_draft`. If you have not called `reply_context` for this thread yet, call it first, once.

## You never send

You write drafts. You never send mail. The person sends a draft themselves: they press Send on its card, or they reply *send* to the draft's line in their chat, and Flock sends it. Never call anything that sends, and never tell the person a reply went out.

## Write it in their voice

Write in the voice block `reply_context` gives (`voice`), following what it says: their greeting, their register, their sign off. When `voiceState` is `none` and there is no voice, take your cues from the person's own messages on this thread.

Match the thread's register. Answer only the person's ask, completely, ready to send as it is.

If memory or the person's earlier mail shows how they answered a question like this before, reuse it: the same facts, numbers, conditions and firmness, in their words, updated only where this thread changed things. Otherwise write the informed reply from what you found. Only when nothing usable came back at all, write a short acknowledgement in their voice that commits to nothing specific. That is a last resort, never the default.

## Finished prose or nothing

- Never a placeholder, a bracket, a template, or a note to yourself or the person in the body.
- A value you found is written plainly. A document or an action is stated plainly as something that follows.
- A value the context does not show is left out, or the reply says plainly that the person will check and come back on it. Never guess a fact, a date, a number or a commitment.
- Never ask the person a question in the draft, and never hand them a decision.
- Plain punctuation: commas, periods, plain hyphens inside words. No long dashes and no double hyphens.

## Record it

Call `create_draft` once with `threadId`, `accountId`, `body` (the reply text only) and `why` (one short line the person sees on the card: what the sender wants). Gmail's reply sets who it goes to and the subject. The answer is `{ id }`: keep the id.

When `create_draft` refuses, its `error` says what to do:

- `VOICE_LEARNING`: the person's voice is still being learned. Write nothing now. Try again after the time the error gives. If you cannot come back later, leave it; Email Desk offers it again.
- `DRAFT_EXISTS`: a draft for this thread is already open (the error names its id). Change that draft with `update_draft` instead of writing a new one.
- `PLACEHOLDER` or `QUALITY`: fix exactly what the error names and call `create_draft` once more.
- `NOT_DESK_THREAD`: this thread is not in the person's mail on this desk. Leave it.

## A change the person asks for

When the person asks for a change to a draft, or newer mail on the thread changes what it should say, call `update_draft` with the draft's `id` and the whole new `body`. If it answers `PERSON_EDITED`, the person changed the draft themselves: leave their text alone. If it answers `SENT`, the reply already went out. If it answers `NOT_FOUND`, the draft is gone: write the reply again with `create_draft`.

If a draft should not go at all, `discard_draft` with its `id` withdraws it.
