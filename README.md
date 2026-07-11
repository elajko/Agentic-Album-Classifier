# Agentic Album Classifier

An agentic image gallery that zero-shot classifies uploads into albums it invents on the fly,
without being told ahead of time what albums should exist. The app adapts its classification
schema as new images arrive. The front-end keeps the original's minimalist, function-first design.

This is a TypeScript/Next.js rewrite of the original [Node.js + `@huggingface/transformers`
prototype](https://github.com/elajko/Agentic-Album-Classifier), built to deploy on Vercel:

- **Classification** runs on a hosted multimodal LLM (Claude or GPT-4o-mini) via the
  [Vercel AI SDK](https://sdk.vercel.ai/) instead of a locally-downloaded CLIP model, since
  Vercel's serverless functions have no room to cache a multi-hundred-MB model on disk. The LLM
  is given the image plus the current albums' names and descriptions and returns a structured
  decision (`ai`'s `generateObject` + Zod) — which is a strictly more capable zero-shot
  classifier than CLIP's embedding-similarity approach, because it can reason about *why* an
  image does or doesn't fit an album, not just measure vector distance.
- **Storage** is [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) instead of the local
  `./db` folder and `schema.json` file, since serverless functions don't have a persistent
  writable disk between invocations.
- **Connecting a key is a bring-your-own-key flow, not a login button.** It's tempting to picture a
  "Sign in with Anthropic" button that hands the app a working key, but there's no such endpoint —
  the closest thing, [Retrieve API Key](https://platform.claude.com/docs/en/api/admin/api_keys/retrieve),
  requires an org-admin OAuth token just to call it, and even then only returns a redacted
  `partial_key_hint`, never the full secret. So instead, the site owner generates a key themselves
  at [console.anthropic.com](https://console.anthropic.com/settings/keys) and pastes it into the
  app's "AI status" dialog, gated by an `ADMIN_SECRET` password. See "AI connection" below.

The app still maintains a single schema (now `schema.json` in Blob storage rather than on disk)
mapping images to labels, so reclassifying/moving files on every request is never necessary. An
auto-created album is deleted once it has no images left in it; user-created albums are pinned and
persist even while empty.

## What's implemented

- [x] Image uploading
- [x] Image/album browsing
- [x] Configuration via environment variables (provider, model, thresholds)
- [x] Classifying images into an album
- [x] **Agentic album creation** — when an image doesn't fit any existing album with at least
      `CLASSIFICATION_THRESHOLD` confidence, the agent invents a new album (name + description) for it.
- [x] **Agentic image reevaluation** — whenever a new album appears (auto-created or user-created),
      the agent re-checks other images whose current confidence is borderline (within
      `REEVALUATION_MARGIN` of the threshold) to see if the new album is actually a better home
      for them, and re-files the ones that are.
- [x] **User-provided albums** — "+ New album" lets you pre-create an album with your own
      name/description; the agent immediately reevaluates existing borderline images against it.
- [x] **Browsing works with no key connected, and nothing is lost while disconnected** — uploads
      made while no AI provider key is connected are filed into a reserved "Unclassified" album
      instead of being rejected. Connecting a key immediately sorts a batch of the backlog, and the
      rest drains automatically as you keep using the app (or on demand via "Rescan Unclassified").
- [x] **Expired/revoked key detection** — there's no separate "is my key still valid" health
      check hitting the provider on a timer; the only way this is ever discovered is as a side
      effect of a real classification call, i.e. when a file is actually uploaded. If that call
      comes back 401/403, the image (already safely stored) isn't silently dropped or misfiled —
      the user gets a prompt with three ways to resolve it. See "Key expiration" below.

## AI connection

The header has an "AI connected" / "AI disconnected" button. Click it to open a dialog:

- **Not connected**: uploads still work, they just land in "Unclassified" untouched. Paste the
  `ADMIN_SECRET` password plus a provider API key (generated at
  [console.anthropic.com](https://console.anthropic.com/settings/keys) or
  [platform.openai.com](https://platform.openai.com/api-keys)) to connect. The key is encrypted
  (AES-256-GCM, keyed off `ADMIN_SECRET`) and stored in a *private* Blob — it's never written to
  disk or committed anywhere, and the dialog never displays it back.
- **Connected via a saved key**: the same dialog password-gates a "Disconnect" button.
- **Connected via `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` env var**: that always takes priority over a
  saved key; disconnect it by removing the env var in your deployment settings instead.
- **Backlog present**: shows how many images are waiting in Unclassified, with a manual "Rescan
  Unclassified" button (also gated by `ADMIN_SECRET`, since each image costs an LLM call).

## Key expiration

Uploading a file is the only thing that ever exercises the provider key, so it's also the only
place expiration is discovered — there's no background poll hitting Anthropic/OpenAI just to check
key health. If the classification call for a freshly-uploaded image comes back 401/403 (key
expired, revoked, or otherwise invalid), the image stays safely in Blob storage but isn't filed
anywhere yet, and a "Uh oh! The key has expired." dialog offers three ways to resolve it:

- **Upload as Unclassified** — file it in the Unclassified bucket for now, same as if no key were
  connected at all; you can reconnect and "Rescan" later.
- **Connect a new key** — opens the same password-gated Connect flow used elsewhere in the app,
  which already targets whichever provider `AI_PROVIDER` is set to (Anthropic or OpenAI). On
  success, the pending image is retried automatically; if the replacement key is *also* rejected,
  the same prompt reappears rather than pretending it worked.
- **Go back** — discards the pending upload (deletes the orphaned blob) and does nothing further.

## Architecture

```
src/
  app/
    api/
      upload/route.ts       POST multipart image -> stores blob, classifies or files as
                             Unclassified, updates schema.json; 401 + key_expired on a rejected key
      upload/resolve/route.ts POST resolve a pending key_expired upload: file as Unclassified,
                             retry classification (after reconnecting), or discard
      images/route.ts       GET  -> current schema.json (albums + images)
      albums/route.ts       POST create a user album (+ reevaluation) / DELETE an empty album
      admin/
        status/route.ts     GET  -> { enabled, source, provider, unclassifiedCount } (no secret needed)
        connect/route.ts    POST save a key + sweep backlog / DELETE remove a saved key
        sweep/route.ts      POST manually drain another batch of Unclassified
    page.tsx                 renders the gallery
    api/local-image/[filename]/route.ts  GET serves images in local storage mode (see below)
  components/AlbumApp.tsx    client-side gallery, upload form, album dialog, AI status dialog
  lib/
    types.ts                 Schema / Album / ImageRecord types, UNCLASSIFIED_ALBUM constant
    config.ts                env-var driven AppConfig
    media.ts                 shared filename -> MIME type inference
    image.ts                 soft downscale applied before every classification call
    store.ts                 picks a storage backend (see "Storage" below) and re-exports it
    storage/blob-backend.ts  Vercel Blob read/write for schema.json and images (production)
    storage/local-backend.ts local-disk equivalent, used automatically without a Blob token
    classify.ts              the classification + agentic orchestration logic
    crypto.ts                AES-256-GCM encrypt/decrypt, timing-safe string compare
    secrets.ts               encrypted key storage + admin password verification
```

## Storage

Where `schema.json` and uploaded images live is chosen automatically by `lib/store.ts`, with no
config needed:

- **`BLOB_READ_WRITE_TOKEN` set** → [Vercel Blob](https://vercel.com/docs/storage/vercel-blob).
  This is the production path, and the only one that works once deployed (serverless functions
  have no persistent disk).
- **Not set** → local disk, under `./local-storage/` (gitignored, never committed). Images are
  served back to the browser via `GET /api/local-image/[filename]`.

Either way, `classify.ts` always reads the image's actual bytes before classifying it (via
`store.ts`'s `getImageBytes`) rather than ever handing the provider a bare URL to fetch itself -
necessary for local mode anyway, since a `localhost` URL isn't reachable from the provider's
servers, and it's what makes the downscaling below possible for Blob-backed images too, at the
cost of one extra fetch through our own function instead of letting the provider pull the URL
directly.

This means you can run the whole app - uploads, classification, browsing - with nothing but an
Anthropic or OpenAI key and zero Vercel setup. The one thing local mode *doesn't* cover: a key
connected at runtime through the "AI classification" dialog's Connect flow is still always stored
in Vercel Blob (`lib/secrets.ts` is unconditional), so if you want to test that specific flow
without `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` set directly in your env, you'll still need a real
Blob token.

## Image downscaling

Every image is run through `lib/image.ts` before classification, purely to cut cost on typical
phone-camera-sized uploads:

- Images already at or under 1568px on both dimensions are left completely untouched - no
  re-encoding, no quality loss. That number isn't arbitrary: it's Claude's own documented target
  size for the long edge of a vision input, so resizing down to it ourselves doesn't throw away
  any detail the model would actually use - it just avoids paying to upload and tokenize a much
  larger original for zero benefit.
- Anything bigger is shrunk to fit within that box (never upscaled) and re-encoded **preserving
  format by content type**, specifically so drawings and line art don't get quietly degraded:
  JPEG inputs (almost always real photos) are re-encoded at high quality (90); everything else -
  PNG, GIF, WebP, which in practice is almost always screenshots, drawings, or line art - is
  re-encoded losslessly as PNG instead. JPEG's block-based compression tends to blur exactly the
  sharp edges and flat colors that kind of image relies on to look distinct from a photo, so it's
  deliberately never used for that content.
- If resizing fails for any reason (corrupt input, unsupported format), the original bytes are
  classified as-is rather than failing the upload.

## Setup

1. Install dependencies.

   ```
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set `AI_PROVIDER` plus the matching
   `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`:

   ```
   cp .env.example .env.local
   ```

   That's enough to run everything locally (see "Storage" above) - `BLOB_READ_WRITE_TOKEN` and
   `ADMIN_SECRET` are only needed if you want to test against a real Vercel Blob store or the
   in-app Connect flow specifically.

3. Run the dev server.

   ```
   npm run dev
   ```

4. Open http://localhost:3000, upload an image, and watch the agent file it.

## Deploying to Vercel

```
npm i -g vercel   # if you don't already have it
vercel link
vercel blob store add   # or create one in the dashboard's Storage tab and link it
vercel env add ADMIN_SECRET
vercel env add ANTHROPIC_API_KEY   # optional - or connect a key via the UI after deploying
vercel deploy --prod
```

Linking a Blob store to the project automatically sets `BLOB_READ_WRITE_TOKEN` for you. The
`upload` and `albums` routes are configured with `maxDuration = 60` since a single request may
involve several LLM calls (the initial classification plus reevaluation of borderline images) —
raise or lower it to match your Vercel plan's function duration limit.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `anthropic` or `openai` |
| `ADMIN_SECRET` | *(none)* | Password gating the "Connect"/"Disconnect"/"Rescan" actions; also used to derive the encryption key for a saved provider key. Required to use the Connect flow at all. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | *(none)* | Set at deploy time to skip the Connect flow entirely; always takes priority over a saved key |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Vision-capable Claude model |
| `OPENAI_MODEL` | `gpt-4o-mini` | Vision-capable OpenAI model |
| `CLASSIFICATION_THRESHOLD` | `0.7` | Minimum confidence to file into an existing album instead of minting a new one |
| `REEVALUATION_MARGIN` | `0.15` | How close to the threshold counts as "borderline" and eligible for reevaluation when a new album appears |
| `MAX_REEVALUATIONS_PER_RUN` | `12` | Caps how many borderline images get reevaluated per new album, to bound request latency |
| `MAX_SWEEP_PER_RUN` | `8` | Caps how many Unclassified images get drained per sweep (on connect, per upload, or via "Rescan"), to bound request latency |

## Possible next steps

- Swap the per-image `generateObject` reevaluation loop for a true tool-calling agent (AI SDK
  `generateText` with `listAlbums`/`createAlbum`/`assignImage` tools and a multi-step loop) so the
  model can decide autonomously how many images to revisit instead of a hand-written heuristic.
- Move reevaluation to a background job (e.g. a Vercel Cron-triggered route or a queue) so large
  batches don't run inside the request/response cycle.
- **Batch multiple images into a single classification call, specifically for `sweepUnclassified`**
  (pinned/deferred for now - noting the idea, not building it). `sweepUnclassified` and
  `reevaluateBorderlineImages` already loop over several images against the same album list one
  request at a time; asking the model to classify a handful of them in one call would amortize the
  repeated system-prompt/album-list text across all of them instead of paying for it per image.
  Worth doing once the Unclassified backlog is actually the cost driver, not before - it only
  touches the shared *text* overhead (the smaller half of the bill; downscaling above already
  addresses the bigger *image*-token half), it doesn't fit the interactive single-upload path at
  all, and it adds real complexity correlating N outputs back to N inputs correctly if the model
  drops or reorders one. See conversation history for the fuller cost-lever comparison (prompt
  caching, the Anthropic Message Batches API, etc.) that led here.
