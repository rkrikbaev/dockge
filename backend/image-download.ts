import childProcessAsync from "promisify-child-process";
import { ValidationError } from "./util-server";
import { consumeOneTimeToken, createOneTimeToken } from "./one-time-link";

/**
 * Download docker images (`docker save`) via one-time links, see one-time-link.ts
 */

const LINK_TYPE = "image-download";

// Must start with a letter or digit, so it can never be parsed as a docker option
const IMAGE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/;

export function validateImageName(image : unknown) : string {
    if (typeof(image) !== "string" || !IMAGE_NAME_REGEX.test(image)) {
        throw new ValidationError("invalidImageName");
    }
    return image;
}

/**
 * Check that the image exists on this host, so the download does not fail halfway
 * @param image Image name, e.g. nginx:latest
 */
export async function checkImageExists(image : string) {
    try {
        await childProcessAsync.spawn("docker", [ "image", "inspect", "--format", "{{.Id}}", image ], {
            encoding: "utf-8",
        });
    } catch (e) {
        throw new ValidationError("imageNotFoundLocally");
    }
}

export function createDownloadToken(image : string) : string {
    return createOneTimeToken(LINK_TYPE, image);
}

/**
 * @returns The image of the link, or undefined if the link is invalid, expired or already used
 */
export function consumeDownloadToken(token : string) : string | undefined {
    return consumeOneTimeToken<string>(LINK_TYPE, token);
}

export function getImageFileName(image : string) : string {
    return image.replace(/[^a-zA-Z0-9._-]/g, "_") + ".tar.gz";
}
