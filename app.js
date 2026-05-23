const fs = require("fs");
const formidable = require("formidable");
const { pipeline, env } = require("@huggingface/transformers");

/*
 * configuration
 */
const hostname = "127.0.0.1";
const port = 3000;

const similarity_threshold = 0.8; // if a new label is not at least this similar to a pre-existing label, generate a new album

/*
 * initialize
 */
let schema = fs.existsSync("./schema.json") ? JSON.parse(fs.readFileSync("./schema.json", "utf8")) :
{   // schema template
    image_to_label: {}, // filename : label
    label_to_album: {}, // label    : album
    albums: {}          // album    : bool (true if strict)
};

if (!fs.existsSync("./db"))
    fs.mkdirSync("./db");

env.cacheDir = "./model"; // make the cache directory local for tidiness

function progress_callback(data) {

    if (data.status === "progress") {
        console.log(`Downloading ${data.file}: ${data.progress.toFixed(2)}%`);
    } else if (data.status === "done") {
        console.log(`Finished loading: ${data.file}`);
    }
}

/*
 * agent behaviour
 */

// TODO adding a strict album just means adding album_name: album_name to label_to_album
// TODO if a new album is created, we should try to reorganize other labels to see if they fit it more

const dot = (x, y) => x.reduce((sum, val, index) => sum + val * y[index], 0);

async function sort_label_into_album(label) {
    
    let other_labels = Object.keys(schema.label_to_album);
    let other_embeddings = await get_label_embeddings([...other_labels, label]);

    let embedding = other_embeddings.pop();
    
    let best_label = null;
    let best_similarity = 0.0;

    // find other label most similar to this one
    for (let i = 0; i < other_labels.length; i++) {

        // calculate similarity (cosine similarity for normalized vectors is just the dot product)
        let similarity = dot(embedding, other_embeddings[i]);

        if (similarity > best_similarity) {

            best_label = other_labels[i];
            best_similarity = similarity;
        }
    }

    if (best_similarity < similarity_threshold) {

        // if none are similar enough (based on similarity_threshold), create a new album (with this label as the name)
        schema.label_to_album[label] = label;

    } else {

        // otherwise, put this label in the same album as the most similar other label
        schema.label_to_album[label] = schema.label_to_album[best_label];
    }
}

async function get_label_embeddings(labels) {

    const extractor = await pipeline("feature-extraction", null, { progress_callback });

    return (await extractor(labels, { pooling: "mean", normalize: true })).tolist();
}

async function classify_image(filename) { // returns null on success, a string on error

    const classifier = await pipeline("image-classification", null, { progress_callback });
    const label = (await classifier("./db/" + filename))[0].label;

    schema.image_to_label[filename] = label;

    // if this label hasn't been sorted into an album, try to find an existing album that fits
    if (schema.label_to_album[label] == undefined)
        sort_label_into_album(label);

    // back-up schema to disk
    try {
        fs.writeFileSync("./schema.json", JSON.stringify(schema, null, 4));
    } catch (err) {
        console.error("Error backing up schema: ", err);
    }

    return null;
}

/*
 * web server
 */

// define the HTTP server that serves our frontend
// no need for HTTPS since this is just a local demo
const server = require("http").createServer();

server.on("request", async (req, res) => {

    const req_type = req.method + " " + req.url;

    console.log(req_type);

    res.setHeader("Content-Type", "text/html");

    switch (req_type) {

        case "GET /":

            res.statusCode = 200;
            res.end(fs.readFileSync("./index.html", "utf8"));
            break;
        
        case "POST /upload":

            if (!req.headers["content-type"].includes("multipart/form-data")) {

                res.statusCode = 400;
                res.end("Bad request; you're doing something weird, aren't you?");
                break;
            }

            new formidable.IncomingForm().parse(req, (err, fields, files) => {

                if (err) {
                    res.statusCode = 500;
                    res.end("Server-side parsing error");
                    return;
                }

                if (!files.image[0].mimetype.includes("image/")) {
                    res.statusCode = 400;
                    res.end("Bad request; you're doing something weird, aren't you?");
                    return;
                }

                let new_filename = files.image[0].originalFilename;

                // prevent collision
                while (schema.image_to_label[new_filename] != undefined)
                    new_filename = "_" + new_filename;

                // save image to db
                fs.renameSync(files.image[0].filepath, "./db/" + new_filename);

                // classify image
                classify_image(new_filename).then((result) => {

                    res.statusCode = 200;
                    res.end(
                        fs.readFileSync("./index.html", "utf8").replace(
                            `<div id="upload-result"></div>`,
                            result
                            ? `<div id="upload-result" style="color: red;">Upload failed: ${ result }</div>`
                            : `<div id="upload-result" style="color: green;">Upload succeeded!</div>`
                        )
                    );
                });
            });

            break;
        
        default:

            res.statusCode = 404;
            res.end("Not found");
            break;
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});

// load the models now so that we don't slow down the first request
pipeline("feature-extraction", null, { progress_callback });
pipeline("image-classification", null, { progress_callback });