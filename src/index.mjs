import axios from 'axios';
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from "http";
import { WebSocketServer } from 'ws';
import { DownloaderHelper } from 'node-downloader-helper';

const app = express();
const port = 9000;
const website = "https://nrhb.971188.xyz/";

let movie_data = [];
let series_data = [];

let downloadHelper = null;
let downloadQueue = [];

// const splitAt = (index, xs) => [xs.slice(0, index), xs.slice(index)];
const regex_entry = /<tr>\n\s+<td><a href="([^"]+)">([^<]+)<\/a><\/td>\n\s+<td class="filesize">\d+<\/td>\n\s+<\/tr>/g;

function parseHtmlEntities(str) {
    return str.replace(/&#([0-9]{1,3});/gi, function (match, numStr) {
        var num = parseInt(numStr, 10); // read num as normal number
        return String.fromCharCode(num);
    });
}

async function fetch_movie_data() {
    try {
        const options = {
            method: 'GET',
            url: website + 'movies/',
        };

        const response = await axios.request(options);

        const matches = [...response.data.replace(/\r/g, "").matchAll(regex_entry)];
        //console.log(typeof(response.data));

        let n_movie_data = [];

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            if (!(match[1].includes("/"))) continue;
            n_movie_data.push({
                "id": "m/" + match[1],
                "title": parseHtmlEntities(match[2])
            });
        }

        movie_data = n_movie_data;
    } catch (error) {
        console.error(error);
    }

    try {
        const options = {
            method: 'GET',
            url: website + 'tvs/',
        };

        const response = await axios.request(options);

        const matches = [...response.data.replace(/\r/g, "").matchAll(regex_entry)];
        //console.log(typeof(response.data));

        let n_series_data = [];

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            if (!(match[1].includes("/"))) continue;
            n_series_data.push({
                "id": "s/" + match[1],
                "title": parseHtmlEntities(match[2])
            });
        }

        series_data = n_series_data;
    } catch (error) {
        console.error(error);
    }

    console.log("Fetched movie and series list.");
}

fetch_movie_data();

function tryToStartDownload() {
    wss.clients.forEach((ws) => {
        ws.send(JSON.stringify({
            type: "downloads",
            data: downloadQueue
        }));
    });
    if (downloadHelper == null && downloadQueue.length > 0) {
        let filePath = "./shared/" + downloadQueue[0].replace(/^tvs\//, "Shows/").replace(/^movies\//, "Movies/");;
        let dirPath = path.dirname(filePath);

        try {
            fs.mkdirSync(dirPath, { recursive: true });
        } catch (error) {
            console.log("failed to make dir:", error);
        }

        downloadHelper = new DownloaderHelper(website + downloadQueue[0], dirPath, {
            retry: { maxRetries: 3, delay: 500 },
            resumeIfFileExists: true,
            progressThrottle: 100
        });

        downloadHelper.on('error', err => console.error('Something happened', err));

        downloadHelper.on('end', () => {
            downloadHelper = null;
            downloadQueue.shift();
            tryToStartDownload();
        });

        downloadHelper.on('skip', () => {
            downloadHelper = null;
            downloadQueue.shift();
            tryToStartDownload();
        });

        downloadHelper.on('progress.throttled', (stats) => {
            wss.clients.forEach((ws) => {
                ws.send(JSON.stringify({
                    type: "status",
                    data: {
                        progress: stats.progress,
                        remainingTime: (stats.total - stats.downloaded) / stats.speed
                    }
                }));
            });
        });

        downloadHelper.start().catch((err) => {
            console.log("failed to download: ", err)

            downloadHelper = null;
            downloadQueue.shift();
            tryToStartDownload();
        });
    }
}

app.get('/', (req, res) => {
    const content = fs.readFileSync("./sites/main.html", "utf-8");
    res.set('Content-Type', 'text/html');
    res.send(content.replace("[]/*movie-data*/", JSON.stringify(movie_data)).replace("[]/*series-data*/", JSON.stringify(series_data)));
});

app.get('/download/m/:name/:file', async (req, res) => {
    if (req.params.name != null && req.params.file != null) {
        downloadQueue.push('movies/' + req.originalUrl.replace("/download/m/", ""));
        tryToStartDownload();
    }
});

app.get('/download/s/:name/:season/:file', async (req, res) => {
    if (req.params.name != null && req.params.season != null && req.params.file != null) {
        downloadQueue.push('tvs/' + req.originalUrl.replace("/download/s/", ""));
        tryToStartDownload();
    }
});

app.get('/options/m/:name', async (req, res) => {
    if (req.params.name != null) {
        const options = {
            method: 'GET',
            url: website + 'movies/' + req.originalUrl.replace("/options/m/", ""),
        };

        console.log(options.url);

        const response = await axios.request(options);

        const matches = [...response.data.replace(/\r/g, "").matchAll(regex_entry)];
        res.set('Content-Type', 'text/json');
        let files = [];

        for (let i = 0; i < matches.length; i++) {
            const file = matches[i];
            files.push(file[1]);
        }

        res.send(JSON.stringify(files));
    }
});

app.get('/options/s/:name', async (req, res) => {
    if (req.params.name != null) {
        const options = {
            method: 'GET',
            url: website + 'tvs/' + req.originalUrl.replace("/options/s/", ""),
        };

        console.log(options.url);

        const response = await axios.request(options);

        const matches = [...response.data.replace(/\r/g, "").matchAll(regex_entry)];
        res.set('Content-Type', 'text/json');
        let files = [];

        for (let i = 0; i < matches.length; i++) {
            const file = matches[i];
            files.push(file[1]);
        }

        res.send(JSON.stringify(files));
    }
});

app.get('/options/s/:name/:season', async (req, res) => {
    if (req.params.name != null && req.params.season != null) {
        const options = {
            method: 'GET',
            url: website + 'tvs/' + req.originalUrl.replace("/options/s/", ""),
        };

        console.log(options.url);

        const response = await axios.request(options);

        const matches = [...response.data.replace(/\r/g, "").matchAll(regex_entry)];
        res.set('Content-Type', 'text/json');
        let files = [];

        for (let i = 0; i < matches.length; i++) {
            const file = matches[i];
            files.push(file[1]);
        }

        wss.clients

        res.send(JSON.stringify(files));
    }
});

// Create an HTTP server and pass the Express app as the request handler
const server = http.createServer(app);

// Create a WebSocket server instance attached to the same HTTP server
const wss = new WebSocketServer({ server });

// Event listener for new WebSocket connections
wss.on('connection', (ws) => {
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.send(JSON.stringify({
        type: "downloads",
        data: downloadQueue
    }));
});

server.listen(port, () => {
    console.log(`WebSocket and Express server started on port ${port}`);
    console.log(`Open your browser to http://localhost:${port}`);
});

process.on('SIGINT', function () {
    process.exit()
});