# WhatsApp Web page fixtures

- `logged-out-qr.html`, `logged-out-phone.html`: web.whatsapp.com's own log-in screens ("Scan to log
  in", and "Enter phone number" after "Log in with phone number"), saved headless on 2026-11-25 with
  no account and no number typed. Scripts, styles, classes and the QR data are taken out.
- `app.html`, `use-here.html`, `loading.html`: STAND-INS, hand-made with made-up data. The signed-in
  screens (chat list, an open chat, search, the message box, "Use here") cannot be saved without
  linking a real account, so these carry the markup the scripts expect (see the header of
  `skills/whatsapp/scripts/_page.ts`). A run on a linked account is what confirms them.

When a live run reads thin or refuses with `PAGE_CHANGED`, save the signed-in page (scripts and
message text taken out, names made up) next to these, add its test, and add the new markup as one
more fallback in `_page.ts`.
