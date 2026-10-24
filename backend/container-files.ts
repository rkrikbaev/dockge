import path from "path";
import { spawn } from "child_process";
import childProcessAsync from "promisify-child-process";
import { ValidationError } from "./util-server";
import { DockgeServer } from "./dockge-server";
import { Stack } from "./stack";

/**
 * Browse, download and upload files of a container
 *
 * Listing uses `docker exec` with sh + stat (available in Debian / Ubuntu / Alpine based images).
 * Downloading a file uses `docker exec cat`, a directory `docker cp` (tar).
 * Uploading uses `docker cp -` with a tar stream built on the fly.
 */

export const MAX_UPLOAD_SIZE = 4 * 1024 * 1024 * 1024;     // 4 GiB
const MAX_LIST_ENTRIES = 5000;

// Name of a tar entry (ustar "name" field)
const MAX_FILE_NAME_BYTES = 100;

export interface FileEntry {
    name : string;
    isDirectory : boolean;
    isSymlink : boolean;
    size : number;
    mtime : number;
}

/**
 * Find the container of a service. Only containers of Dockge stacks can be accessed.
 * @returns Container name of the first replica
 */
export async function getServiceContainer(server : DockgeServer, stackName : unknown, serviceName : unknown) : Promise<string> {
    if (typeof(stackName) !== "string" || typeof(serviceName) !== "string") {
        throw new ValidationError("Stack name and service name must be strings");
    }

    const stack = await Stack.getStack(server, stackName);
    const list = (await stack.getServiceStatusList()).get(serviceName) as { name : string }[] | undefined;

    if (!list || list.length === 0 || !list[0].name) {
        throw new ValidationError("containerNotFound");
    }
    return list[0].name;
}

export function validateContainerPath(containerPath : unknown) : string {
    if (typeof(containerPath) !== "string" || !containerPath.startsWith("/") || containerPath.includes("\0") || containerPath.length > 4096) {
        throw new ValidationError("invalidPath");
    }
    return path.posix.normalize(containerPath);
}

export function validateFileName(fileName : unknown) : string {
    if (typeof(fileName) !== "string" || fileName === "" || fileName === "." || fileName === ".." ||
        fileName.includes("/") || fileName.includes("\0") || Buffer.byteLength(fileName) > MAX_FILE_NAME_BYTES) {
        throw new ValidationError("invalidFileName");
    }
    return fileName;
}

/**
 * Run a sh script in the container. The path is passed as $1, never inside the script, so it cannot inject commands.
 */
async function execScript(container : string, script : string, arg : string) : Promise<string> {
    try {
        const res = await childProcessAsync.spawn("docker", [ "exec", container, "sh", "-c", script, "sh", arg ], {
            encoding: "utf-8",
            maxBuffer: 50 * 1024 * 1024,
        });
        return res.stdout?.toString() ?? "";
    } catch (e) {
        const err = e as { code? : number, stderr? : string };
        const stderr = err.stderr?.toString() ?? "";

        if (err.code === 3) {
            throw new ValidationError("directoryNotFound");
        }
        if (stderr.includes("is not running")) {
            throw new ValidationError("containerNotRunning");
        }
        if (stderr.includes("executable file not found")) {
            throw new ValidationError("containerHasNoShell");
        }
        throw new Error(stderr.trim() || "docker exec failed");
    }
}

export async function listDirectory(container : string, dir : string) : Promise<{ entries : FileEntry[], truncated : boolean }> {
    // T|<d or f>|<symlink 0/1>|name  (type is resolved through symlinks)
    // S|size|mtime|name              (of the entry itself)
    // Unmatched globs stay literal, stat prints an error for them which is ignored
    const script = `
cd -- "$1" 2>/dev/null || exit 3
for f in * .[!.]* ..?*; do
    if [ -e "$f" ] || [ -L "$f" ]; then
        t=f; [ -d "$f" ] && t=d
        l=0; [ -L "$f" ] && l=1
        printf 'T|%s|%s|%s\\n' "$t" "$l" "$f"
    fi
done
stat -c 'S|%s|%Y|%n' -- * .[!.]* ..?* 2>/dev/null
exit 0
`;
    const output = await execScript(container, script, dir);
    const map : Map<string, FileEntry> = new Map();

    for (const line of output.split("\n")) {
        const parts = line.split("|");
        if (parts.length < 4) {
            continue;
        }
        const name = parts.slice(3).join("|");

        if (parts[0] === "T") {
            map.set(name, {
                name,
                isDirectory: parts[1] === "d",
                isSymlink: parts[2] === "1",
                size: map.get(name)?.size ?? 0,
                mtime: map.get(name)?.mtime ?? 0,
            });
        } else if (parts[0] === "S") {
            const entry = map.get(name);
            if (entry) {
                entry.size = Number(parts[1]) || 0;
                entry.mtime = Number(parts[2]) || 0;
            }
        }
    }

    // Directories first, then by name
    const entries = [ ...map.values() ].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    return {
        entries: entries.slice(0, MAX_LIST_ENTRIES),
        truncated: entries.length > MAX_LIST_ENTRIES,
    };
}

/**
 * @returns "d" for a directory, "f" for anything else
 */
export async function getPathType(container : string, containerPath : string) : Promise<"d" | "f"> {
    const output = await execScript(container, `
[ -e "$1" ] || exit 3
if [ -d "$1" ]; then echo d; else echo f; fi
`, containerPath);
    return output.trim() === "d" ? "d" : "f";
}

/**
 * Stream a file (raw) or a directory (tar)
 */
export function spawnDownload(container : string, containerPath : string, isDirectory : boolean) {
    if (isDirectory) {
        return spawn("docker", [ "cp", `${container}:${containerPath}`, "-" ]);
    }
    return spawn("docker", [ "exec", container, "cat", "--", containerPath ]);
}

/**
 * Header of a single regular file in a ustar archive
 */
export function createTarHeader(fileName : string, size : number) : Buffer {
    const header = Buffer.alloc(512, 0);
    const writeString = (value : string, offset : number, length : number) => {
        header.write(value, offset, length, "utf-8");
    };
    const writeOctal = (value : number, offset : number, length : number) => {
        writeString(value.toString(8).padStart(length - 1, "0"), offset, length - 1);
    };

    writeString(fileName, 0, 100);
    writeOctal(0o644, 100, 8);                                  // mode
    writeOctal(0, 108, 8);                                      // uid
    writeOctal(0, 116, 8);                                      // gid
    writeOctal(size, 124, 12);                                  // size
    writeOctal(Math.floor(Date.now() / 1000), 136, 12);         // mtime
    writeString("        ", 148, 8);                            // checksum placeholder
    writeString("0", 156, 1);                                   // regular file
    writeString("ustar\0", 257, 6);
    writeString("00", 263, 2);

    let checksum = 0;
    for (const byte of header) {
        checksum += byte;
    }
    writeString(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    return header;
}

/**
 * Padding of the file data + end of archive (two empty blocks)
 */
export function createTarTrailer(size : number) : Buffer {
    const padding = (512 - (size % 512)) % 512;
    return Buffer.alloc(padding + 1024, 0);
}

export function spawnUpload(container : string, dir : string) {
    return spawn("docker", [ "cp", "-", `${container}:${dir}` ]);
}
