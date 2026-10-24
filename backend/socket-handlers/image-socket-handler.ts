import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkAdmin, DockgeSocket } from "../util-server";
import { checkImageExists, createDownloadToken, validateImageName } from "../image-download";

export class ImageSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        // Create a one-time link for downloading an image of this host (admin only, images may contain private code or secrets)
        socket.on("createImageDownload", async (image : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);
                const imageName = validateImageName(image);
                await checkImageExists(imageName);

                callbackResult({
                    ok: true,
                    url: "/api/image-download/" + createDownloadToken(imageName),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }
}
