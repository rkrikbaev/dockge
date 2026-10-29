import { Socket } from "socket.io";
import { Terminal } from "./terminal";
import { randomBytes } from "crypto";
import { log } from "./log";
import { ERROR_TYPE_VALIDATION } from "../common/util-common";
import { R } from "redbean-node";
import { verifyPassword } from "./password-hash";
import fs from "fs";
import { AgentManager } from "./agent-manager";
import { hasRole, Role, ROLE_ADMIN } from "../common/roles";

export interface JWTDecoded {
    username : string;
    h? : string;
}

export interface DockgeSocket extends Socket {
    userID: number;
    userRole? : Role;
    // Stacks a non-admin user can access, see stack-access.ts
    stackAccess? : Set<string>;
    consoleTerminal? : Terminal;
    instanceManager : AgentManager;
    endpoint : string;
    emitAgent : (eventName : string, ...args : unknown[]) => void;
}

// For command line arguments, so they are nullable
export interface Arguments {
    sslKey? : string;
    sslCert? : string;
    sslKeyPassphrase? : string;
    port? : number;
    hostname? : string;
    dataDir? : string;
    stacksDir? : string;
    enableConsole? : boolean;
}

// Some config values are required
export interface Config extends Arguments {
    dataDir : string;
    stacksDir : string;
}

export function checkLogin(socket : DockgeSocket) {
    if (!socket.userID) {
        throw new Error("You are not logged in.");
    }
}

/**
 * Throw if the user is not logged in or the role is lower than required
 * @param socket Socket of the user
 * @param requiredRole Minimum role required
 */
export function checkRole(socket : DockgeSocket, requiredRole : Role) {
    checkLogin(socket);
    if (!hasRole(socket.userRole, requiredRole)) {
        throw new Error("permissionDenied");
    }
}

export function checkAdmin(socket : DockgeSocket) {
    checkRole(socket, ROLE_ADMIN);
}

export class ValidationError extends Error {
    constructor(message : string) {
        super(message);
    }
}

export function callbackError(error : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }

    if (error instanceof Error) {
        callback({
            ok: false,
            msg: error.message,
            msgi18n: true,
        });
    } else if (error instanceof ValidationError) {
        callback({
            ok: false,
            type: ERROR_TYPE_VALIDATION,
            msg: error.message,
            msgi18n: true,
        });
    } else {
        log.debug("console", "Unknown error: " + error);
    }
}

export function callbackResult(result : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }
    callback(result);
}

export async function doubleCheckPassword(socket : DockgeSocket, currentPassword : unknown) {
    if (typeof currentPassword !== "string") {
        throw new Error("Wrong data type?");
    }

    let user = await R.findOne("user", " id = ? AND active = 1 ", [
        socket.userID,
    ]);

    if (!user || !verifyPassword(currentPassword, user.password)) {
        throw new Error("Incorrect current password");
    }

    return user;
}

export function fileExists(file : string) {
    return fs.promises.access(file, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
}
