import path from "path";
import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkAdmin, DockgeSocket, ValidationError } from "../util-server";
import {
    getPathType,
    getServiceContainer,
    listDirectory,
    MAX_UPLOAD_SIZE,
    validateContainerPath,
    validateFileName
} from "../container-files";
import { createOneTimeToken } from "../one-time-link";

export const CONTAINER_DOWNLOAD_LINK = "container-file-download";
export const CONTAINER_UPLOAD_LINK = "container-file-upload";

export interface ContainerDownload {
    container : string;
    path : string;
    isDirectory : boolean;
}

export interface ContainerUpload {
    container : string;
    dir : string;
    fileName : string;
    size : number;
}

/**
 * Files of containers on this host (admin only, it is as powerful as a terminal)
 * Downloads and uploads are done via HTTP with one-time links, see routers/main-router.ts
 */
export class ContainerFilesSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        socket.on("listContainerFiles", async (stackName : unknown, serviceName : unknown, dir : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);
                const container = await getServiceContainer(server, stackName, serviceName);
                const dirPath = validateContainerPath(dir);
                const { entries, truncated } = await listDirectory(container, dirPath);

                callbackResult({
                    ok: true,
                    path: dirPath,
                    entries,
                    truncated,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("createContainerFileDownload", async (stackName : unknown, serviceName : unknown, filePath : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);
                const container = await getServiceContainer(server, stackName, serviceName);
                const containerPath = validateContainerPath(filePath);

                if (containerPath === "/") {
                    throw new ValidationError("invalidPath");
                }

                const download : ContainerDownload = {
                    container,
                    path: containerPath,
                    isDirectory: await getPathType(container, containerPath) === "d",
                };

                callbackResult({
                    ok: true,
                    url: "/api/container-files/download/" + createOneTimeToken(CONTAINER_DOWNLOAD_LINK, download),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("createContainerFileUpload", async (stackName : unknown, serviceName : unknown, dir : unknown, fileName : unknown, size : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);
                const container = await getServiceContainer(server, stackName, serviceName);
                const dirPath = validateContainerPath(dir);
                const name = validateFileName(fileName);

                if (typeof(size) !== "number" || !Number.isInteger(size) || size < 0) {
                    throw new ValidationError("Size must be a number");
                }
                if (size > MAX_UPLOAD_SIZE) {
                    throw new ValidationError("uploadFileTooLarge");
                }
                if (await getPathType(container, dirPath) !== "d") {
                    throw new ValidationError("directoryNotFound");
                }

                const upload : ContainerUpload = {
                    container,
                    dir: dirPath,
                    fileName: name,
                    size,
                };

                callbackResult({
                    ok: true,
                    path: path.posix.join(dirPath, name),
                    url: "/api/container-files/upload/" + createOneTimeToken(CONTAINER_UPLOAD_LINK, upload),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }
}
