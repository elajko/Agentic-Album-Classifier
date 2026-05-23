const fs = require("fs");
const formidable = require("formidable");
const { pipeline, env } = require("@huggingface/transformers");

/*
 * configuration (TODO move this to an external config.json)
 */
const hostname = "127.0.0.1";
const port = 3000;

const classification_threshold = 0.7;                        // if an image does not get labeled with at least this confidence, create a new label
const classification_model = "Xenova/clip-vit-base-patch32"; // https://huggingface.co/models?pipeline_tag=image-classification&library=transformers.js

/*
 * initialize
 */
const schema = fs.existsSync("./schema.json") ? JSON.parse(fs.readFileSync("./schema.json", "utf8")) :
{   // schema template
    image_to_label: {},
    possible_labels: ["bird", "tree", "comic"] // albums are internally called labels
};

if (!fs.existsSync("./db"))
    fs.mkdirSync("./db");

env.cacheDir = "./model"; // make the cache directory local for tidiness

function progress_callback(data) {

    if (data.status === "progress")
        console.log(`Downloading ${data.file}: ${data.progress.toFixed(2)}%`);
    else if (data.status === "done")
        console.log(`Finished loading: ${data.file}`);
}

let classifier = pipeline("zero-shot-image-classification", classification_model, { progress_callback });

/*
 * agent behaviour
 */

async function classify_image(filename) {

    if (classifier instanceof Promise)
        classifier = await classifier;

    const label = (await classifier("./db/" + filename, schema.possible_labels))[0].label;

    // TODO account for confidence and classification_threshold, creating a new label as necessary

    schema.image_to_label[filename] = label;

    // back-up schema to disk
    try {
        fs.writeFileSync("./schema.json", JSON.stringify(schema, null, 4));
    } catch (err) {
        console.error("Error backing up schema: ", err);
    }
}

/*
 * web server
 */
function get_index(result = "") {

    const label_to_images = {};

    for (const image of Object.keys(schema.image_to_label)) {

        const label = schema.image_to_label[image];

        if (label_to_images[label]) {
            label_to_images[label].push(image);
        } else {
            label_to_images[label] = [ image ];
        }
    }

    let construct = "";

    for (const label of Object.keys(label_to_images)) {

        construct += `<h2>${ label }</h2>`;

        for (const image of label_to_images[label]) {

            construct += `<img height="200" src="/img/${ image }">`;
        }
    }

    return fs.readFileSync("./index.html", "utf8")
    .replace(
        `<div id="upload-result"></div>`,
        result
    )
    .replace(
        `<div id="browse-area"></div>`,
        construct
    );
}

// define the HTTP server that serves our frontend
// no need for HTTPS since this is just a local demo
const server = require("http").createServer();

server.on("request", async (req, res) => {

    const req_type = req.method + " " + req.url;

    console.log(req_type);

    // respond
    if (req_type.startsWith("GET /img/")) {

        fs.readFile("./db/" + req.url.substring(5), (err, data) => {
            
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("Image not found");
            } else {
                res.writeHead(404, { "Content-Type": "image/" + req.url.substring(req.url.lastIndexOf(".") + 1).toLowerCase() });
                res.end(data);
            }
        });
        
    } else {

        res.setHeader("Content-Type", "text/html");

        switch (req_type) {

            case "GET /":

                res.statusCode = 200;
                res.end(get_index());
                break;
            
            case "POST /":

                if (!req.headers["content-type"].includes("multipart/form-data")) {

                    res.statusCode = 400;
                    res.end(get_index(`<div id="upload-result" style="color: red;">POST request content was the wrong type; you're doing something weird, aren't you?</div>`));
                    break;
                }

                new formidable.IncomingForm().parse(req, (err, fields, files) => {

                    if (err) {

                        // TODO check if the error is because no file was sent

                        res.statusCode = 500;
                        res.end(get_index(`<div id="upload-result" style="color: red;">Upload failed: Server-side parsing error</div>`));
                        return;
                    }

                    if (!files.image[0].mimetype.includes("image/")) {

                        res.statusCode = 400;
                        res.end(get_index(`<div id="upload-result" style="color: red;">Server received a file other than an image; you're doing something weird, aren't you?</div>`));
                        return;
                    }

                    let new_filename = files.image[0].originalFilename;

                    // prevent collision
                    while (schema.image_to_label[new_filename] != undefined)
                        new_filename = "_" + new_filename;

                    // save image to db
                    fs.renameSync(files.image[0].filepath, "./db/" + new_filename);

                    // classify image
                    classify_image(new_filename).then(() => {

                        res.statusCode = 200;
                        res.end(get_index(`<div id="upload-result" style="color: green;">Upload succeeded!</div>`));
                    });
                });

                break;
            
            default:

                res.statusCode = 404;
                res.end("Not found");
                break;
        }
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});