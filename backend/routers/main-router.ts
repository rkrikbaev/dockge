import { DockgeServer } from "../dockge-server";
import { Router } from "../router";
import express, { Express, Router as ExpressRouter } from "express";
import { spawn } from "child_process";
import zlib from "zlib";
import { consumeDownloadToken, getImageFileName } from "../image-download";
import { log } from "../log";
import path from "path";
import { attachmentHeader, consumeOneTimeToken } from "../one-time-link";
import { createTarHeader, createTarTrailer, spawnDownload, spawnUpload } from "../container-files";
import {
    CONTAINER_DOWNLOAD_LINK,
    CONTAINER_UPLOAD_LINK,
    ContainerDownload,
    ContainerUpload
} from "../socket-handlers/container-files-socket-handler";

export class MainRouter extends Router {
    create(app: Express, server: DockgeServer): ExpressRouter {
        const router = express.Router();

        router.get("/", (req, res) => {
            res.send(server.indexHTML);
        });

        // Robots.txt
        router.get("/robots.txt", async (_request, response) => {
            let txt = "User-agent: *\nDisallow: /";
            response.setHeader("Content-Type", "text/plain");
            response.send(txt);
        });

        // Download a docker image (docker save), gzipped. The one-time link is created by "createImageDownload".
        router.get("/api/image-download/:token", (request, response) => {
            const image = consumeDownloadToken(request.params.token);

            if (!image) {
                response.status(404).send("The download link is invalid or expired.");
                return;
            }

            log.info("image-download", `Downloading image ${image}`);

            const child = spawn("docker", [ "save", image ]);
            const gzip = zlib.createGzip({
                level: 1,   // Images are big, prefer speed
            });

            let stderr = "";
            child.stderr.on("data", (data) => {
                stderr += data;
            });

            response.setHeader("Content-Type", "application/gzip");
            response.setHeader("Content-Disposition", `attachment; filename="${getImageFileName(image)}"`);
            child.stdout.pipe(gzip).pipe(response);

            child.on("close", (code) => {
                if (code !== 0) {
                    log.error("image-download", `docker save ${image} failed: ${stderr}`);
                    // Abort, so the browser marks the download as failed instead of saving a broken file
                    response.destroy();
                }
            });

            // Browser cancelled the download
            response.on("close", () => {
                if (!response.writableFinished) {
                    child.kill();
                }
            });
        });

        // Download a file (as is) or a directory (.tar.gz) of a container. The link is created by "createContainerFileDownload".
        router.get("/api/container-files/download/:token", (request, response) => {
            const download = consumeOneTimeToken<ContainerDownload>(CONTAINER_DOWNLOAD_LINK, request.params.token);

            if (!download) {
                response.status(404).send("The download link is invalid or expired.");
                return;
            }

            log.info("container-files", `Downloading ${download.container}:${download.path}`);

            const child = spawnDownload(download.container, download.path, download.isDirectory);
            const baseName = path.posix.basename(download.path);

            let stderr = "";
            child.stderr.on("data", (data) => {
                stderr += data;
            });

            if (download.isDirectory) {
                response.setHeader("Content-Type", "application/gzip");
                response.setHeader("Content-Disposition", attachmentHeader(baseName + ".tar.gz"));
                child.stdout.pipe(zlib.createGzip({
                    level: 1,
                })).pipe(response);
            } else {
                response.setHeader("Content-Type", "application/octet-stream");
                response.setHeader("Content-Disposition", attachmentHeader(baseName));
                child.stdout.pipe(response);
            }

            child.on("close", (code) => {
                if (code !== 0) {
                    log.error("container-files", `Download of ${download.container}:${download.path} failed: ${stderr}`);
                    // Abort, so the browser marks the download as failed instead of saving a broken file
                    response.destroy();
                }
            });

            // Browser cancelled the download
            response.on("close", () => {
                if (!response.writableFinished) {
                    child.kill();
                }
            });
        });

        // Upload a file into a directory of a container (raw request body). The link is created by "createContainerFileUpload".
        router.put("/api/container-files/upload/:token", (request, response) => {
            const upload = consumeOneTimeToken<ContainerUpload>(CONTAINER_UPLOAD_LINK, request.params.token);

            if (!upload) {
                response.status(404).json({
                    ok: false,
                    msg: "The upload link is invalid or expired.",
                });
                return;
            }

            // The size is written into the tar header before the data, so it must be known and exact
            if (Number(request.headers["content-length"]) !== upload.size) {
                response.status(400).json({
                    ok: false,
                    msg: "Content-Length does not match the file size.",
                });
                return;
            }

            log.info("container-files", `Uploading ${upload.fileName} (${upload.size} bytes) to ${upload.container}:${upload.dir}`);

            const child = spawnUpload(upload.container, upload.dir);
            let received = 0;
            let stderr = "";
            let finished = false;

            child.stderr.on("data", (data) => {
                stderr += data;
            });

            // docker cp exits early, e.g. the container is gone
            child.stdin.on("error", () => {});

            child.stdin.write(createTarHeader(upload.fileName, upload.size));

            request.on("data", (chunk : Buffer) => {
                received += chunk.length;
                if (!child.stdin.write(chunk)) {
                    request.pause();
                    child.stdin.once("drain", () => request.resume());
                }
            });

            request.on("end", () => {
                if (received !== upload.size) {
                    child.kill();
                    return;
                }
                child.stdin.end(createTarTrailer(upload.size));
            });

            // Upload cancelled before all data arrived: kill docker cp, so an incomplete archive is not extracted
            request.on("close", () => {
                if (received !== upload.size) {
                    child.kill();
                }
            });

            child.on("close", (code) => {
                finished = true;
                if (response.headersSent) {
                    return;
                }
                if (code === 0 && received === upload.size) {
                    response.json({
                        ok: true,
                    });
                } else {
                    log.error("container-files", `Upload to ${upload.container}:${upload.dir} failed: ${stderr}`);
                    response.status(500).json({
                        ok: false,
                        msg: stderr.trim() || "Upload failed",
                    });
                }
            });

            response.on("close", () => {
                if (!finished) {
                    child.kill();
                }
            });
        });

        return router;
    }

}
