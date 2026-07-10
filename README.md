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

## Architecture

```
src/
  app/
    api/
      upload/route.ts    POST multipart image -> stores blob, classifies, updates schema.json
      images/route.ts     GET  -> current schema.json (albums + images)
      albums/route.ts     POST create a user album (+ reevaluation) / DELETE an empty album
    page.tsx               renders the gallery
  components/AlbumApp.tsx  client-side gallery, upload form, album dialog
  lib/
    types.ts               Schema / Album / ImageRecord types
    config.ts               env-var driven AppConfig
    store.ts                Vercel Blob read/write for schema.json and images
    classify.ts             the classification + agentic orchestration logic
```

## Setup

1. Install dependencies.

   ```
   npm install
   ```

2. Create a [Vercel Blob store](https://vercel.com/docs/storage/vercel-blob) and copy its
   read/write token, and get an API key from [Anthropic](https://console.anthropic.com/) or
   [OpenAI](https://platform.openai.com/). Copy `.env.example` to `.env.local` and fill it in:

   ```
   cp .env.example .env.local
   ```

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
vercel env add ANTHROPIC_API_KEY   # or OPENAI_API_KEY, matching AI_PROVIDER
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
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Vision-capable Claude model |
| `OPENAI_MODEL` | `gpt-4o-mini` | Vision-capable OpenAI model |
| `CLASSIFICATION_THRESHOLD` | `0.7` | Minimum confidence to file into an existing album instead of minting a new one |
| `REEVALUATION_MARGIN` | `0.15` | How close to the threshold counts as "borderline" and eligible for reevaluation when a new album appears |
| `MAX_REEVALUATIONS_PER_RUN` | `12` | Caps how many borderline images get reevaluated per new album, to bound request latency |

## Possible next steps

- Swap the per-image `generateObject` reevaluation loop for a true tool-calling agent (AI SDK
  `generateText` with `listAlbums`/`createAlbum`/`assignImage` tools and a multi-step loop) so the
  model can decide autonomously how many images to revisit instead of a hand-written heuristic.
- Move reevaluation to a background job (e.g. a Vercel Cron-triggered route or a queue) so large
  batches don't run inside the request/response cycle.
