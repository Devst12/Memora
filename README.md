# Memora

Memora is a private digital memory for links, videos, articles, ideas, and inspiration you want to find again. Save a link with a reason, category, tags, notes, and an optional in-app reminder, then search and revisit it later.

## Phase 1 status

Implemented in this repository:

- Responsive web app with private email/password accounts and secure HTTP-only sessions.
- MongoDB persistence with per-user ownership checks and indexes.
- Link capture, platform detection, public page metadata previews, URL normalization, and duplicate protection.
- Search across saved-item text, tags, category, reason, platform, and author/site fields; platform, status, category, reason, and date filters; paginated API results.
- Timeline, inactivity-based Forgotten view, saved-item detail/edit/delete, completion/archive states, and in-app reminders.
- User-managed categories, tags, and reasons.
- Chromium Manifest V3 extension with popup capture and a right-click capture action, using a revocable account token.

This is Phase 1 only. Mobile apps, screen-time tracking, AI, social features, subscriptions, and payments are intentionally out of scope.

## Architecture

- **Web and REST API:** Next.js App Router, React, TypeScript, Tailwind CSS.
- **Database:** MongoDB collections `users`, `sessions`, `saved_items`, `categories`, `tags`, `reasons`, `activity`, and `extension_tokens`. Compound per-user indexes enforce ownership and URL duplicate protection.
- **Authentication:** Node `scrypt` password hashes, HMAC-signed HTTP-only session cookies, and server-verified extension tokens. No auth or database secrets are exposed to the browser.
- **Metadata:** Server-side fetch of public HTML metadata with timeouts, redirect limits, content-size limit, URL/DNS checks, and a graceful fallback. The app does not scrape private platform content or bypass platform protections.
- **Extension:** `extension/` is an unpacked Chromium Manifest V3 extension. It calls the same authenticated capture endpoint as the web app.

## Requirements

- Node.js 20.19 or newer.
- MongoDB 6.0+ locally or a MongoDB Atlas database.
- npm (lockfile included).

## Local setup

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `MONGODB_URI`, `MONGODB_DATABASE`, and a unique `AUTH_SECRET` with at least 32 characters. For example, generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
4. Start MongoDB locally or use an Atlas connection string.
5. Run `npm run dev`, then visit `http://localhost:3000` and create your account.

MongoDB collections and indexes are created on first use. User-specific default categories and reasons are created on signup.

## Browser extension

1. Run the web app and sign into Memora.
2. Open **Settings → Browser extension → Generate capture token**. Copy the token immediately; Memora stores only its hash. Create a new token if you lose the value, then revoke old tokens by removing them from Settings (the API supports revocation).
3. In Chrome or Edge, open the extensions page, enable Developer mode, choose **Load unpacked**, and select this repo’s `extension/` directory.
4. Open the extension popup. Enter the app origin, such as `http://localhost:3000`, and the capture token. Approve its origin access.
5. Use any of the three capture paths:
   - **Floating side button** — a small “m” bubble sits on the right edge of every page. Click it to save the current page instantly; the title, reason, category, and tags are inferred automatically, and a toast on the page confirms what was saved. Drag it up or down to reposition.
   - **Right-click menu** — “Save to Memora” on a page or link saves it and reports the outcome through the same on-page toast.
   - **Popup** — for control over title, reason, category, and notes before saving.

Auto-categorization is deterministic keyword scoring in `lib/auto-tags.ts`: it matches page text against your own categories and picks a reason (Watch Later for video platforms, Learn for docs/repositories, and so on), generating up to five tags from the title and domain. Explicit fields from the popup always win over suggestions. Duplicate captures return HTTP 409 and the toast shows “Already in your memory” instead of erroring.

**Auto-save rules** (Settings → Auto-save rules) let you map keywords to categories — e.g. `react, next.js → Web Development`. The first rule whose keyword appears in the link's URL, title, or live page text wins and outranks the built-in heuristics. The extension sends the real tab URL (resolved via `chrome.tabs`, so SPA feeds like TikTok are saved as the video you're actually watching, never a bare `tiktok.com`) plus visible page headings and hashtags as context keywords.

TikTok links are canonicalized server-side (`lib/content.ts`): `vm.tiktok.com/XYZ`, `tiktok.com/t/XYZ`, `m.tiktok.com/v/@user/video/123.html`, and `www.tiktok.com/@user/video/123?is_from_webapp=1…` all collapse to one address per video, so the same video saved from different share forms is recognized as a duplicate instead of polluting your memory.

The extension token grants save-only access. Treat it like a password. Revoke it if the extension profile or device is shared or lost.

## API

All user data routes require a valid session cookie, except the extension capture route, which accepts a bearer capture token.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account |
| POST | `/api/auth/login` | Start a session |
| POST | `/api/auth/logout` | End current session |
| GET | `/api/auth/me` | Current account |
| GET, POST | `/api/saved-items` | Search/list or save (supports `q`, `page`, `limit`, `platform`, `status`, `category`, `reason`, `date`, `forgotten`) |
| GET, PATCH, DELETE | `/api/saved-items/:id` | Read, update, or delete an owned save |
| GET, POST, PATCH, DELETE | `/api/taxonomy/categories`, `/api/taxonomy/tags`, `/api/taxonomy/reasons` | Manage per-user taxonomy |
| GET | `/api/dashboard` | Summary, recent/forgotten saves, reminders, and activity |
| GET, POST, DELETE | `/api/extension-token` | List active token IDs, generate a token (shown once), revoke by ID |
| POST | `/api/extension/capture` | Extension capture (bearer token) |

### Saved-item payload

`POST /api/saved-items` accepts `{ "url": "https://…", "title": "", "reason": "Learn", "categoryId": "…", "tags": ["nextjs"], "notes": "…", "reminderAt": "ISO date or null" }`. A duplicate returns HTTP 409 with the existing item. All item operations include the authenticated user in their MongoDB filter.

## Search, reminders, and limits

- Search is case-insensitive token matching across indexed item fields and taxonomy names. Results are paginated (`limit` up to 50); a later semantic-search adapter can replace this query without changing item ownership or API structure.
- Forgotten saves are unread or in-progress items saved at least seven days ago and not opened during that period. This is a computed view, not a permanent status.
- Reminders are stored on the item and surfaced in the app when due. Phase 1 does not include background email/push delivery, so reminders are visible when the user opens Memora.
- Public page metadata is best-effort. Sites can block server requests or return incomplete metadata; the link still saves. Network-level DNS pinning and an external egress proxy should be used for a hardened public deployment because DNS can change between validation and connection.
- Signup and login attempts are rate-limited using MongoDB counters. In production, configure the trusted ingress to overwrite `X-Forwarded-For`; do not accept client supplied forwarding headers directly.

## Build and deployment

- `npm run lint` checks the app.
- `npm run build` creates the production build.
- `npm run start` serves the build.
- Configure MongoDB network access and a strong `AUTH_SECRET` in the hosting provider’s secret store. Use HTTPS in production.
- The extension’s configured app origin must be reachable by the browser and included in Chrome’s requested host permission.

## Development demo seed

Set `SEED_EMAIL` and `SEED_PASSWORD` in `.env.local`, then run `npm run seed`. Seed data is inserted only for that account, is marked with `isDemoSeed: true`, and will not overwrite existing saved items. Use a disposable development database and remove demo rows before using the account as a personal library.

## Roadmap

- **Phase 2 — Mobile Capture:** Android app and native share-sheet capture.
- **Phase 3 — Attention Tracking:** opt-in website/app activity connected to saved content.
- **Phase 4 — Personal Intelligence:** summaries, organization, patterns, and private search assistance.
