# Agentic Album Classifier

An agentic image database that uses zero-shot classification to organize images into albums without being explicitly told
what albums are necessary, adapting its classification schema on the fly in response to user input. Front-end demonstrates
minimalist, function-first design principles.

## Design

The AI is given the high-level goal of independently organizing a dynamic image gallery.
It classifies each image individually and groups together images with related (but
not necessarily identical) classifications without human assistance.

A human user may create "strict" albums that the AI cannot remove
or rename (but can still sort images into them); the AI will take those
strict albums into account in creating its organization schema.

The AI maintains a single "schema.json" file that prevents unnecessary processing
or reclassification of images.

## Dependencies

```
npm i formidable
npm i @huggingface/transformers
```