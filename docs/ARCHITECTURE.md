# Hatchmail architecture

## Goal

Hatchmail is a small multi-user webmail application that runs as a Nuxt application on Cloudflare Workers. Mailgun receives SMTP mail for configured domains and forwards parsed inbound messages to Hatchmail. Hatchmail sends outbound mail through the Mailgun HTTP API.

## Platform

- **UI and server:** Nuxt 4 / Nitro deployed to Cloudflare Workers with Workers Assets.
- **Relational data:** Cloudflare D1 (SQLite semantics) for users, addresses, domains, sessions, messages, attachment metadata, replay tokens, and audit events.
- **Blob data:** Cloudflare R2 for inbound and outbound attachment bodies.
- **Inbound mail:** Mailgun Route `forward()` action posts to `/webhooks/mailgun/inbound`.
- **Outbound mail:** Mailgun `POST /v3/{domain}/messages`.

## Domain and identity model

A login account is a `user`. A user has one or more `addresses`, each composed of a local part and a configured domain. This avoids coupling authentication usernames to mail routing and permits one user to own addresses on multiple domains.

Inbound mail is delivered only when the exact recipient address exists and belongs to an active user. Outbound mail is accepted only when the selected From address belongs to the authenticated user.

Administrators can manage users, addresses, domains, Mailgun configuration, and view the audit log.

## Secrets

Mailgun API keys and webhook signing keys are configurable in the admin UI, but are never stored in plaintext. The Worker receives a `SETTINGS_ENCRYPTION_KEY` Cloudflare secret. Per-domain Mailgun credentials are encrypted with AES-GCM before they are stored in D1.

The bootstrap token and settings encryption key are deployment secrets and must be configured with Wrangler or the Cloudflare dashboard, never committed to the repository.

## Authentication

Passwords are salted and hashed with PBKDF2-HMAC-SHA256 using Web Crypto. Login creates a cryptographically random opaque session token. Only a SHA-256 digest of the token is stored in D1; the original token is held in an HttpOnly, Secure, SameSite=Lax cookie. Sessions are revocable and expire server-side.

The initial administrator is created through a one-time bootstrap endpoint that works only while the users table is empty and requires `BOOTSTRAP_TOKEN`.

## Mail flow

### Inbound

1. Mailgun receives SMTP mail for a configured domain.
2. A Mailgun Route forwards the parsed message to `/webhooks/mailgun/inbound`.
3. Hatchmail determines the domain from Mailgun's envelope `recipient` field.
4. It loads and decrypts that domain's webhook signing key.
5. It verifies Mailgun's HMAC-SHA256 signature and rejects stale/replayed tokens.
6. It resolves the recipient to a Hatchmail address/user.
7. Message metadata and bodies are stored in D1; attachments are stored in R2.
8. Hatchmail returns HTTP 200. Unknown recipients return HTTP 406 so Mailgun does not retry an intentionally rejected message.

### Outbound

1. An authenticated user composes mail and chooses one of their addresses.
2. The server verifies ownership of the From address and loads that domain's encrypted Mailgun credentials.
3. Hatchmail submits multipart form data to Mailgun's Messages API.
4. A sent-mail record is written to D1 with the Mailgun message ID and an audit event is recorded.

## Data model

- `users`
- `domains`
- `addresses`
- `sessions`
- `messages`
- `attachments`
- `webhook_tokens`
- `audit_log`

The initial schema is in `migrations/0001_initial.sql`.

## Deliberate MVP boundaries

The first implementation focuses on safe multi-user send/receive, basic folders, attachments, administration, and auditability. Threading, contacts, rich-text editing, spam controls, message search, password reset, MFA, quotas, background delivery-state webhooks, and advanced alias rules are follow-on work.