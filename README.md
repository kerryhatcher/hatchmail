# Hatchmail

Hatchmail is a small, self-hosted webmail application built with Nuxt and deployed as a Cloudflare Worker. Mailgun handles SMTP delivery: inbound messages are forwarded to Hatchmail over a signed HTTP route, and outbound messages are submitted through Mailgun's Messages API.

The current implementation is an MVP intended for a small organization or personal multi-domain mail service.

## Features

- Cloudflare Workers + Workers Assets deployment
- Nuxt 4 user interface and server routes
- Cloudflare D1 for users, domains, sessions, mail metadata, and audit records
- Cloudflare R2 for attachment bodies
- Multiple local users with username/password authentication
- Administrator and user roles
- Multiple hosted mail domains
- Multiple email addresses per user
- Per-address outbound permission and a primary address
- Mailgun US and EU API regions
- Signed Mailgun inbound webhook verification with replay protection
- Mailgun HTTP API outbound delivery
- Inbox, Sent, Archive, and Trash folders
- Message read/star state
- Attachments on inbound and outbound messages
- User/domain administration and an audit log
- One-time first-administrator bootstrap flow
- Encrypted-at-rest Mailgun API and webhook signing keys

## Architecture

```text
Internet SMTP
    |
    v
  Mailgun
    | signed forward() POST
    v
Cloudflare Worker / Nuxt
    |---- D1: users, domains, sessions, messages, audit
    |---- R2: attachment bytes
    |
    +---- Mailgun Messages API ----> outbound SMTP
```

See [Architecture](docs/ARCHITECTURE.md) for the security model and data flow, and [Research notes](docs/RESEARCH.md) for the primary-source Cloudflare and Mailgun documentation used for the design.

## Quick start

A real deployment requires a Cloudflare account with Workers, D1, and R2 plus a Mailgun account/domain.

```bash
npm install
npx wrangler login
npx wrangler d1 create hatchmail-db
npx wrangler r2 bucket create hatchmail-attachments
```

Copy the D1 database ID returned by Wrangler into `wrangler.jsonc`, then configure the two Worker secrets:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put SETTINGS_ENCRYPTION_KEY

node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put BOOTSTRAP_TOKEN
```

Apply the schema and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

Open `/setup` on the deployed hostname, enter the bootstrap token, and create the first administrator. Then open **Admin → Domains** to add each Mailgun domain, API key, webhook signing key, and Mailgun region. Finally configure a Mailgun receiving Route to forward inbound mail for the domain to:

```text
https://YOUR-HATCHMAIL-HOST/webhooks/mailgun/inbound
```

Full instructions are in [Deployment](docs/DEPLOYMENT.md).

## Development

Install dependencies and generate Nuxt types:

```bash
npm install
npm run typecheck
npm run build
```

For a Cloudflare-local preview with D1/R2 bindings, create the local database schema first and use Wrangler:

```bash
npm run db:migrate:local
npm run preview
```

Copy `.dev.vars.example` to `.dev.vars` for local-only Worker secrets. Never commit `.dev.vars` or production credentials.

`npm run dev` runs the Nuxt development server and is useful for frontend work, but server routes that depend on Cloudflare bindings require the Wrangler preview path above.

## Security notes

Passwords are PBKDF2-HMAC-SHA256 salted hashes. Session cookies contain random opaque tokens; only token hashes are stored in D1. Mailgun credentials are encrypted with AES-GCM using a Worker secret that is never stored in D1. Inbound Mailgun requests require a valid HMAC signature, a recent timestamp, and a previously unseen token.

The UI renders the plain-text part of received mail rather than injecting remote HTML. This is intentional for the MVP and avoids an HTML-email XSS surface until a sanitizer and remote-content policy are added.

## UI mockups

### Mail

![Hatchmail mail UI mockup](docs/mockups/mail-ui.jpg)

### Admin

![Hatchmail admin users UI mockup](docs/mockups/admin-users-ui.jpg)

## MVP limitations

Draft persistence, full-text search, contacts, HTML mail rendering, advanced MIME/threading, password reset, MFA, quotas, delivery-status webhooks, spam controls, aliases/catch-alls, and automated Mailgun Route creation are not implemented yet.

## License

MIT. See [LICENSE](LICENSE).
