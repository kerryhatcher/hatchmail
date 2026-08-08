# Deployment

This guide takes a new Hatchmail installation from an empty Cloudflare account configuration to a working first administrator and Mailgun domain.

## Prerequisites

- Node.js 22 or newer
- A Cloudflare account with Workers, D1, and R2 available
- Wrangler authenticated to that account
- A Mailgun account with at least one verified sending/receiving domain

Hatchmail does not provision Mailgun DNS records. Complete the domain-verification and receiving DNS steps shown by Mailgun for each domain you plan to host.

## 1. Install dependencies

```bash
npm install
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create hatchmail-db
```

Wrangler prints a database ID. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with that value.

Apply the schema:

```bash
npm run db:migrate:remote
```

## 3. Create the R2 bucket

```bash
npx wrangler r2 bucket create hatchmail-attachments
```

The repository's `wrangler.jsonc` already binds that bucket as `ATTACHMENTS`. If you choose a different bucket name, update the configuration to match.

## 4. Configure Worker secrets

Hatchmail uses two deployment secrets:

- `SETTINGS_ENCRYPTION_KEY`: exactly 32 random bytes encoded as base64url. It encrypts Mailgun credentials stored in D1.
- `BOOTSTRAP_TOKEN`: a high-entropy one-time credential used only to create the first administrator.

Generate independent random values, then save them with Wrangler:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put SETTINGS_ENCRYPTION_KEY

node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put BOOTSTRAP_TOKEN
```

Store the encryption key in a secure secret manager/backup. Losing it makes the encrypted Mailgun credentials already stored in D1 unreadable. Rotating it currently requires re-entering all Mailgun credentials.

## 5. Build and deploy

```bash
npm run typecheck
npm run build
npm run deploy
```

Wrangler will show the deployed Worker hostname unless you have configured a custom route/domain.

## 6. Create the first administrator

Visit:

```text
https://YOUR-HATCHMAIL-HOST/setup
```

Enter the `BOOTSTRAP_TOKEN`, display name, username, and a password of at least 12 characters. Hatchmail creates the first account as an administrator and signs it in.

The setup API refuses additional bootstrap attempts after any user exists.

## 7. Add a Mailgun domain

Open **Admin → Domains → Add domain** and enter:

- the exact domain hosted by Mailgun, such as `example.org`
- Mailgun region: US or EU
- a Mailgun API key authorized to send for the domain/account
- the Mailgun webhook signing key
- Active status

The API key and signing key are encrypted before being written to D1. The admin API never returns the decrypted values to the browser; it only reports whether each credential is configured.

## 8. Configure Mailgun inbound routing

In Mailgun, create a receiving Route for the hosted domain that forwards matching inbound messages to:

```text
https://YOUR-HATCHMAIL-HOST/webhooks/mailgun/inbound
```

Hatchmail uses Mailgun's envelope `recipient` value to resolve the exact local user/address, so the same endpoint can receive messages for every domain configured in Hatchmail.

Mailgun should be configured to forward the parsed message rather than expecting Hatchmail to accept SMTP directly. Messages with attachments arrive as multipart form data. Hatchmail verifies Mailgun's `timestamp`, `token`, and `signature` before accepting the message.

Unknown/inactive recipient addresses intentionally return HTTP 406. This tells Mailgun the route does not apply and avoids retrying an intentionally rejected recipient. Valid messages return HTTP 200.

## 9. Create users and addresses

Open **Admin → Users → Add user**. Each login account can have one or more addresses. For every address you can choose:

- local part
- hosted domain
- whether it is primary
- whether the user may send from it

Inbound mail is delivered only to an exact active address. Outbound requests are rejected unless the selected From address belongs to the authenticated user and has sending enabled.

## Multiple domains

Repeat the Mailgun-domain and receiving-route setup for each hosted domain. Hatchmail selects the stored Mailgun API region and credentials based on the From/recipient domain.

## Local Cloudflare preview

Create a local secrets file:

```bash
cp .dev.vars.example .dev.vars
```

Fill it with local-only random values, then create the local D1 schema and start the Wrangler preview:

```bash
npm run db:migrate:local
npm run preview
```

The preview builds the Nuxt application first and runs the generated Cloudflare Worker through Wrangler so the `DB` and `ATTACHMENTS` bindings exist.

## Updating

For application updates:

```bash
npm install
npm run typecheck
npm run build
npm run db:migrate:remote
npm run deploy
```

D1 migrations are designed to be applied before the new Worker is deployed when a release adds schema changes. Review release notes before production upgrades.

## Operational considerations

- Back up D1 and any critical R2 data according to your retention requirements.
- Protect the Cloudflare account and Mailgun account with strong MFA.
- Keep `SETTINGS_ENCRYPTION_KEY` outside the repository and outside D1.
- Restrict the Mailgun API credential to the least privilege available for the deployment.
- Monitor Worker errors and Mailgun delivery logs during initial rollout.
- The current MVP stores messages indefinitely until a user/account is deleted; production deployments should define a retention/quota policy.
