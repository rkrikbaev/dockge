import { randomBytes } from "crypto";

/**
 * One-time links for HTTP downloads / uploads
 *
 * A browser download (or an upload with progress) cannot send the login token, so a logged-in user requests a link via socket.io first.
 * A link can be used once within TOKEN_TTL_MS. Each link carries a "type", so a link cannot be used for another kind of request.
 */

const TOKEN_TTL_MS = 60 * 1000;

interface LinkEntry {
    type : string;
    payload : unknown;
    expires : number;
}

const linkList : Map<string, LinkEntry> = new Map();

export function createOneTimeToken(type : string, payload : unknown) : string {
    // Remove expired links
    const now = Date.now();
    for (const [ token, entry ] of linkList) {
        if (entry.expires < now) {
            linkList.delete(token);
        }
    }

    const token = randomBytes(32).toString("hex");
    linkList.set(token, {
        type,
        payload,
        expires: now + TOKEN_TTL_MS,
    });
    return token;
}

/**
 * @returns The payload of the link, or undefined if the link is invalid, expired, already used or of another type
 */
export function consumeOneTimeToken<T>(type : string, token : string) : T | undefined {
    const entry = linkList.get(token);

    if (!entry || entry.type !== type) {
        return undefined;
    }

    linkList.delete(token);

    if (entry.expires < Date.now()) {
        return undefined;
    }
    return entry.payload as T;
}

/**
 * Content-Disposition header for a download, supports non-ASCII file names
 * @param fileName File name shown in the browser
 */
export function attachmentHeader(fileName : string) : string {
    const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
