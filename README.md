# Agentic Album Classifier

An agentic image database that implements zero-shot classification to organize images into albums without being told ahead of time
what sort of albums to create, adapting its classification schema on the fly in response to new images. The front-end demonstrates
minimalist, function-first design principles.

The AI maintains a single "schema.json" file that prevents unnecessary processing from reclassification and moving files (that would
be necessary if albums were represented as directories). An album is deleted when it no longer has any images that resolve to it.

## Features

- [x] Image uploading
- [x] Image/album browsing
- [x] Configuration file (for both server and classification settings)
- [x] Classifying images into an album
- [ ] Agentic album creation when an image is added that doesn't fit nicely into existing albums
- [ ] Agentic image reevaluation when a new album is created
- [ ] Allow the user to optionally provide their own albums

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

## Configuration

A `config.json` file is automatically generated the first time you start the node server. It contains the following key-value pairs:

#### 'hostname' (default: "127.0.0.1")

#### 'port' (default: 3000)

#### 'classification_threshold' (default: 0.7)

If an image does not get labeled with at least this confidence, create a new label.

#### 'classification_model' (default: ["Xenova/clip-vit-base-patch32"](https://huggingface.co/Xenova/clip-vit-base-patch32))

The zero-shot image classification model; browse models [here](https://huggingface.co/models?pipeline_tag=image-classification&library=transformers.js).
