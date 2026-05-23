# Agentic Album Classifier

An agentic image database that implements zero-shot classification to organize images into albums without being told ahead of time
what sort of albums to create, adapting its classification schema on the fly in response to new images. The front-end demonstrates
minimalist, function-first design principles.

## Design

The AI is given the high-level goal of independently organizing a dynamic image gallery. It individually assigns to each image
a label, grouping together images with related (but not necessarily identical) labels into albums, and creating/removing albums
as necessary, all without human guidance.

A human user may create "strict" albums that the AI cannot remove or rename (but can still sort images into); the AI will take
strict albums into account when creating its organization schema.

The AI maintains a single "schema.json" file that prevents unnecessary processing from reclassification and moving files (that
would be necessary if albums were represented as directories).

## Features

- [x] Image uploading
- [x] Classifying images with a label
- [ ] Sorting images into albums based on their label
- [ ] Image/album browsing
- [ ] "Strict" albums

## Installation

1. Install node dependencies.

```
npm i formidable
npm i @huggingface/transformers
```

2. Clone the repository.

```
git clone https://github.com/elajko/Agentic-Album-Classifier
cd Agentic-Album-Classifier
```

3. Start the node server.

```
node app.js
```