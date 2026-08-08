# Research notes

Research date: 2026-08-08

This file records the primary-source documentation used for the initial Hatchmail design.

## Cloudflare Workers + Nuxt

Cloudflare documents direct Nuxt deployment to Workers with Workers Assets. Wrangler can detect Nuxt and uses `.output/server/index.mjs` as the Worker entry point, `.output/public` for assets, the `nodejs_compat` compatibility flag, and the Nuxt `cloudflare` Nitro preset.

Source: https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/

Cloudflare bindings make D1 and R2 resources available to Worker code without ordinary API credentials. In Nuxt server handlers, deployed Cloudflare bindings are available from `event.context.cloudflare.env`.

Sources:

- https://developers.cloudflare.com/workers/runtime-apis/bindings/
- https://developers.cloudflare.com/pages/framework-guides/deploy-a-nuxt-site/#use-bindings-in-your-nuxt-application

D1 provides SQLite semantics and a native Workers binding API. R2 exposes `put()` and `get()` directly through an R2 binding.

Sources:

- https://developers.cloudflare.com/d1/
- https://developers.cloudflare.com/d1/worker-api/
- https://developers.cloudflare.com/r2/get-started/workers-api/

## Mailgun receiving

Mailgun Routes can match recipients and use a `forward()` action to POST inbound mail to an HTTP endpoint.

Source: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/routes

For HTTP forwarding, Mailgun sends either URL-encoded form data or multipart form data when attachments exist. Important fields include `signature`, `timestamp`, `token`, `subject`, `sender`, `from`, `recipient`, `message-headers`, `body-plain`, and one or more `body-html` values. Attachments are sent as `attachment-1`, `attachment-2`, etc.

Mailgun documents special response behavior: HTTP 200 acknowledges the post, HTTP 406 rejects it without retry, and most other failures are retried.

Source: https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http

## Mailgun signature verification

Mailgun signs webhook/forward payloads using HMAC-SHA256. Verification is performed by concatenating the timestamp and token with no separator, computing HMAC-SHA256 using the webhook signing key, and comparing the hexadecimal digest to `signature`. Mailgun also recommends replay protection and a reasonable timestamp check.

Source: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks

## Mailgun sending

Mailgun sends messages through `POST /v3/{domain_name}/messages` using HTTP Basic authentication and multipart form data. Required/important fields include `from`, `to`, `subject`, and at least one of `text`, `html`, `amp-html`, or `template`. Attachments can be supplied as repeated `attachment` fields.

Mailgun has distinct US and EU API base URLs.

Source: https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages

## Design consequences

1. A single Worker application can host both the Nuxt UI and mail/webhook server routes.
2. D1 is appropriate for application metadata and R2 for attachment bytes.
3. Mailgun credentials need to be selected per domain because Hatchmail supports multiple domains and both Mailgun regions.
4. Unknown inbound recipients should return 406 rather than a generic error.
5. Webhook signing keys are security-sensitive and should be encrypted at rest rather than stored as ordinary D1 configuration values.
6. Message ingestion should be idempotent/replay-resistant because Mailgun retries failed posts.