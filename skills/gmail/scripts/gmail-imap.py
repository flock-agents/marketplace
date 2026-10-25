#!/usr/bin/env python3
"""Gmail IMAP/SMTP backend for app-password-based instances."""

import imaplib
import smtplib
import email
import email.utils
import json
import re
import sys
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from email.header import decode_header
import mimetypes

def sanitize_imap_value(s):
    return re.sub(r'[^a-zA-Z0-9@._\- ]', '', s)

def validate_msg_uid(uid):
    if not re.fullmatch(r'[0-9]+', str(uid)):
        print(json.dumps({"error": "Invalid message ID — must be a numeric UID"}), file=sys.stderr)
        sys.exit(1)
    return str(uid)

def sanitize_label_name(s):
    return re.sub(r'[\x00-\x1f\x7f\\"]', '', str(s))

def decode_hdr(raw):
    if not raw:
        return ""
    parts = decode_header(raw)
    result = []
    for data, charset in parts:
        if isinstance(data, bytes):
            result.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(data)
    return " ".join(result)

def connect_imap(email_addr, password):
    m = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    m.login(email_addr, password)
    return m

def msg_to_dict(msg, uid):
    subject = decode_hdr(msg.get("Subject", ""))
    from_addr = decode_hdr(msg.get("From", ""))
    to_addr = decode_hdr(msg.get("To", ""))
    date = msg.get("Date", "")
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    body = payload.decode("utf-8", errors="replace")
                    break
            elif ct == "text/html" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    html = payload.decode("utf-8", errors="replace")
                    body = re.sub(r"<[^>]+>", "", html)[:2000]
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")
    return {
        "id": str(uid),
        "subject": subject,
        "from": from_addr,
        "to": to_addr,
        "date": date,
        "snippet": body[:200].replace("\n", " ").strip(),
        "body": body,
    }

def cmd_list_inbox(creds, params):
    max_results = int(params.get("maxResults", 10))
    query = params.get("query", "")
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX", readonly=True)
    criteria = "ALL" if not query else f'(SUBJECT "{sanitize_imap_value(query)}")'
    _, data = m.search(None, criteria)
    uids = data[0].split()
    uids = uids[-max_results:] if uids else []
    uids.reverse()
    results = []
    for uid in uids:
        _, msg_data = m.fetch(uid, "(RFC822.HEADER)")
        if msg_data and msg_data[0] and isinstance(msg_data[0], tuple):
            msg = email.message_from_bytes(msg_data[0][1])
            d = msg_to_dict(msg, uid.decode())
            del d["body"]
            del d["to"]
            results.append(d)
    m.logout()
    print(json.dumps(results))

def cmd_get_email(creds, params):
    msg_id = params.get("messageId", "")
    if not msg_id:
        print(json.dumps({"error": "messageId required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX", readonly=True)
    _, msg_data = m.fetch(msg_id.encode(), "(RFC822)")
    if not msg_data or not msg_data[0] or not isinstance(msg_data[0], tuple):
        print(json.dumps({"error": f"Message {msg_id} not found"}), file=sys.stderr)
        sys.exit(1)
    msg = email.message_from_bytes(msg_data[0][1])
    result = msg_to_dict(msg, msg_id)
    attachments = []
    if msg.is_multipart():
        for part in msg.walk():
            fn = part.get_filename()
            if fn:
                attachments.append({
                    "filename": fn,
                    "mimeType": part.get_content_type(),
                    "size": len(part.get_payload(decode=True) or b""),
                })
    result["attachments"] = attachments
    m.logout()
    print(json.dumps(result))

def cmd_search(creds, params):
    query = params.get("query", "")
    max_results = int(params.get("maxResults", 10))
    if not query:
        print(json.dumps({"error": "query required"}), file=sys.stderr)
        sys.exit(1)
    m = connect_imap(creds["email"], creds["password"])
    try:
        m.select('"[Gmail]/All Mail"', readonly=True)
    except imaplib.IMAP4.error:
        m.select("INBOX", readonly=True)
    criteria_parts = []
    q = query
    fr = re.search(r"from:(\S+)", q, re.I)
    if fr:
        criteria_parts.append(f'FROM "{sanitize_imap_value(fr.group(1))}"')
        q = re.sub(r"from:\S+", "", q, flags=re.I)
    su = re.search(r"subject:([\"']?)(.+?)\1(?:\s+\w+:|$)", q, re.I)
    if su:
        criteria_parts.append(f'SUBJECT "{sanitize_imap_value(su.group(2).strip())}"')
        q = re.sub(r"subject:[\"']?[^\"']+[\"']?", "", q, flags=re.I)
    if "is:unread" in q.lower():
        criteria_parts.append("UNSEEN")
        q = re.sub(r"is:unread", "", q, flags=re.I)
    if "is:starred" in q.lower():
        criteria_parts.append("FLAGGED")
        q = re.sub(r"is:starred", "", q, flags=re.I)
    remaining = q.strip()
    if remaining and not criteria_parts:
        criteria_parts.append(f'SUBJECT "{sanitize_imap_value(remaining)}"')
    imap_query = " ".join(criteria_parts) if criteria_parts else "ALL"
    _, data = m.search(None, imap_query)
    uids = data[0].split()
    uids = uids[-max_results:] if uids else []
    uids.reverse()
    results = []
    for uid in uids:
        _, msg_data = m.fetch(uid, "(RFC822.HEADER)")
        if msg_data and msg_data[0] and isinstance(msg_data[0], tuple):
            msg = email.message_from_bytes(msg_data[0][1])
            d = msg_to_dict(msg, uid.decode())
            del d["body"]
            del d["to"]
            results.append(d)
    m.logout()
    print(json.dumps({"messages": results, "count": len(results)}))

def cmd_list_labels(creds, _params):
    m = connect_imap(creds["email"], creds["password"])
    _, data = m.list()
    labels = []
    for item in data:
        if isinstance(item, bytes):
            parts = item.decode().split('"/"')
            if len(parts) >= 2:
                name = parts[-1].strip().strip('"')
                labels.append({"id": name, "name": name, "type": "user"})
    m.logout()
    print(json.dumps({"labels": labels}))

MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25 MB per file

def _parse_attachments(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return [p.strip() for p in raw if isinstance(p, str) and p.strip()]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [p.strip() for p in parsed if isinstance(p, str) and p.strip()]
        except (json.JSONDecodeError, ValueError):
            pass
        return [p.strip() for p in raw.split(",") if p.strip()]
    return []

def cmd_send_email(creds, params):
    to = params.get("to", "")
    subject = params.get("subject", "")
    body = params.get("body", "")
    if not to or not subject:
        print(json.dumps({"error": "to and subject required"}), file=sys.stderr)
        sys.exit(1)
    attachment_paths = _parse_attachments(params.get("attachments"))
    if attachment_paths:
        msg = MIMEMultipart("mixed")
        msg["From"] = creds["email"]
        msg["To"] = to
        msg["Subject"] = subject
        if params.get("cc"):
            msg["Cc"] = params["cc"]
        msg.attach(MIMEText(body, "plain", "utf-8"))
        for fpath in attachment_paths:
            if not os.path.isfile(fpath):
                print(json.dumps({"error": f"Attachment not found: {fpath}"}), file=sys.stderr)
                sys.exit(1)
            fsize = os.path.getsize(fpath)
            if fsize > MAX_ATTACHMENT_SIZE:
                print(json.dumps({"error": f"Attachment too large ({fsize} bytes, max {MAX_ATTACHMENT_SIZE}): {fpath}"}), file=sys.stderr)
                sys.exit(1)
            ctype, _ = mimetypes.guess_type(fpath)
            if ctype is None:
                ctype = "application/octet-stream"
            maintype, subtype = ctype.split("/", 1)
            with open(fpath, "rb") as f:
                part = MIMEBase(maintype, subtype)
                part.set_payload(f.read())
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=os.path.basename(fpath))
            msg.attach(part)
    else:
        msg = MIMEText(body, "plain", "utf-8")
        msg["From"] = creds["email"]
        msg["To"] = to
        msg["Subject"] = subject
        if params.get("cc"):
            msg["Cc"] = params["cc"]
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(creds["email"], creds["password"])
        recipients = [to]
        if params.get("cc"):
            recipients.extend(params["cc"].split(","))
        if params.get("bcc"):
            recipients.extend(params["bcc"].split(","))
        s.sendmail(creds["email"], recipients, msg.as_string())
    print(json.dumps({"success": True, "message": "Email sent"}))

def cmd_reply(creds, params):
    msg_id = params.get("messageId", "")
    body_text = params.get("body", "")
    if not msg_id or not body_text:
        print(json.dumps({"error": "messageId and body are required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX", readonly=True)
    _, msg_data = m.fetch(msg_id.encode(), "(RFC822)")
    if not msg_data or not msg_data[0] or not isinstance(msg_data[0], tuple):
        print(json.dumps({"error": f"Message {msg_id} not found"}), file=sys.stderr)
        sys.exit(1)
    orig = email.message_from_bytes(msg_data[0][1])
    m.logout()
    orig_from = decode_hdr(orig.get("From", ""))
    _, reply_addr = email.utils.parseaddr(orig_from)
    if not reply_addr or "@" not in reply_addr:
        print(json.dumps({"error": "Could not extract a valid reply address from original message"}), file=sys.stderr)
        sys.exit(1)
    orig_subject = decode_hdr(orig.get("Subject", ""))
    orig_msg_id = orig.get("Message-ID", "")
    orig_references = orig.get("References", "")
    reply_subject = orig_subject if orig_subject.startswith("Re:") else f"Re: {orig_subject}"
    references = f"{orig_references} {orig_msg_id}".strip()
    reply = MIMEText(body_text, "plain", "utf-8")
    reply["From"] = creds["email"]
    reply["To"] = orig_from
    reply["Subject"] = reply_subject
    reply["In-Reply-To"] = orig_msg_id
    reply["References"] = references
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(creds["email"], creds["password"])
        s.sendmail(creds["email"], [reply_addr], reply.as_string())
    print(json.dumps({"success": True, "message": "Reply sent"}))

def cmd_create_draft(creds, params):
    print(json.dumps({"error": "Draft creation not supported via IMAP. Use sendEmail to send directly."}), file=sys.stderr)
    sys.exit(1)

def cmd_send_draft(creds, params):
    print(json.dumps({"error": "Sending drafts not supported via IMAP. Use sendEmail to send directly."}), file=sys.stderr)
    sys.exit(1)

def cmd_mark_read(creds, params):
    msg_id = params.get("messageId", "")
    if not msg_id:
        print(json.dumps({"error": "messageId required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX")
    m.store(msg_id.encode(), "+FLAGS", "\\Seen")
    m.logout()
    print(json.dumps({"success": True, "message": "Email marked as read"}))

def cmd_mark_unread(creds, params):
    msg_id = params.get("messageId", "")
    if not msg_id:
        print(json.dumps({"error": "messageId required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX")
    m.store(msg_id.encode(), "-FLAGS", "\\Seen")
    m.logout()
    print(json.dumps({"success": True, "message": "Email marked as unread"}))

def cmd_create_label(creds, params):
    label_name = params.get("name", "")
    if not label_name:
        print(json.dumps({"error": "name is required"}), file=sys.stderr)
        sys.exit(1)
    label_name = sanitize_label_name(label_name)
    m = connect_imap(creds["email"], creds["password"])
    try:
        status, _ = m.create(label_name)
        if status != "OK":
            print(json.dumps({"error": f"Failed to create label: {label_name}"}), file=sys.stderr)
            sys.exit(1)
    finally:
        m.logout()
    print(json.dumps({"success": True, "name": label_name}))

def cmd_apply_label(creds, params):
    msg_id = params.get("messageId", "")
    label_name = params.get("labelName", "")
    if not msg_id or not label_name:
        print(json.dumps({"error": "messageId and labelName are required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    label_name = sanitize_label_name(label_name)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX")
    try:
        status, _ = m.copy(msg_id.encode(), label_name)
        if status != "OK":
            print(json.dumps({"error": f"Failed to apply label '{label_name}' to message {msg_id}"}), file=sys.stderr)
            sys.exit(1)
    finally:
        m.logout()
    print(json.dumps({"success": True, "messageId": msg_id, "label": label_name}))

def cmd_archive(creds, params):
    msg_id = params.get("messageId", "")
    if not msg_id:
        print(json.dumps({"error": "messageId required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX")
    status, _ = m.copy(msg_id.encode(), "[Gmail]/All Mail")
    if status != "OK":
        m.logout()
        print(json.dumps({"error": "Failed to copy message to All Mail — aborting archive to prevent data loss"}), file=sys.stderr)
        sys.exit(1)
    try:
        m.store(msg_id.encode(), "+FLAGS", "\\Deleted")
        m.expunge()
    finally:
        m.logout()
    print(json.dumps({"success": True}))

def cmd_star(creds, params):
    msg_id = params.get("messageId", "")
    if not msg_id:
        print(json.dumps({"error": "messageId required"}), file=sys.stderr)
        sys.exit(1)
    msg_id = validate_msg_uid(msg_id)
    m = connect_imap(creds["email"], creds["password"])
    m.select("INBOX")
    m.store(msg_id.encode(), "+FLAGS", "\\Flagged")
    m.logout()
    print(json.dumps({"success": True}))

COMMANDS = {
    "listInbox": cmd_list_inbox,
    "getEmail": cmd_get_email,
    "searchEmails": cmd_search,
    "listLabels": cmd_list_labels,
    "sendEmail": cmd_send_email,
    "replyToMessage": cmd_reply,
    "createDraft": cmd_create_draft,
    "sendDraft": cmd_send_draft,
    "markRead": cmd_mark_read,
    "markUnread": cmd_mark_unread,
    "archiveMessage": cmd_archive,
    "starMessage": cmd_star,
    "createLabel": cmd_create_label,
    "applyLabel": cmd_apply_label,
}

if __name__ == "__main__":
    func = os.environ.get("SKILL_FUNCTION", "")
    params_raw = os.environ.get("SKILL_PARAMS", "{}")
    creds_raw = os.environ.get("SECRET_IMAP_CREDENTIALS", "")
    if not creds_raw:
        print(json.dumps({"error": "No IMAP credentials found"}), file=sys.stderr)
        sys.exit(1)
    try:
        creds = json.loads(creds_raw)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid IMAP credentials JSON"}), file=sys.stderr)
        sys.exit(1)
    if "password" in creds:
        creds["password"] = re.sub(r'\s+', '', creds["password"])
    try:
        params = json.loads(params_raw)
    except json.JSONDecodeError:
        params = {}
    handler = COMMANDS.get(func)
    if not handler:
        print(json.dumps({"error": f"Unknown function: {func}. Available: {list(COMMANDS.keys())}"}), file=sys.stderr)
        sys.exit(1)
    try:
        handler(creds, params)
    except imaplib.IMAP4.error:
        print(json.dumps({"error": "IMAP connection failed. Check your email and app password, and ensure IMAP is enabled in Gmail settings."}), file=sys.stderr)
        sys.exit(1)
    except smtplib.SMTPAuthenticationError:
        print(json.dumps({"error": "SMTP authentication failed. Check your app password and ensure 2-Step Verification is enabled."}), file=sys.stderr)
        sys.exit(1)
    except smtplib.SMTPException:
        print(json.dumps({"error": "Failed to send email via SMTP. Check your app password and ensure 2-Step Verification is enabled."}), file=sys.stderr)
        sys.exit(1)
