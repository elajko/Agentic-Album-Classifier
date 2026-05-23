const fs = require("fs");
const formidable = require("formidable");

const hostname = "127.0.0.1";
const port = 3000;

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

/*
 * agent behaviour
 */
async function add_album(albums_name, is_strict) {

    // TODO
}

async function classify_image(filename, classifier) { // returns null on success, a string on error

    const label = (await classifier("./db/" + filename))[0].label;

    schema.image_to_label[filename] = label;

    // TODO put the image into the correct album based on its label; if its label
    // TODO hasn't been sorted into an album, sort it (which may involve creating a new album!)

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
(async () => {

    let { pipeline, env } = await import("@huggingface/transformers");

    // make the cache directory local for tidiness
    env.cacheDir = "./model";

    // return classifier instance
    return await pipeline("image-classification", null, { progress_callback: (data) => {
        if (data.status === "progress") {
            console.log(`Downloading ${data.file}: ${data.progress.toFixed(2)}%`);
        } else if (data.status === "done") {
            console.log(`Finished loading: ${data.file}`);
        }
    }});

})().then((classifier) => {

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
                    classify_image(new_filename, classifier).then((result) => {

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
});