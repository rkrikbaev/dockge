import { R } from "redbean-node";
import childProcessAsync from "promisify-child-process";
import { DockgeServer } from "./dockge-server";
import { DockgeSocket } from "./util-server";
import { log } from "./log";
import { hasRole, ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER } from "../common/roles";
import { getCombinedTerminalName, getComposeTerminalName } from "../common/util-common";

/**
 * Per-stack access for operators and viewers
 *
 * Admins can access every stack. Operators and viewers can only access the stacks assigned to them
 * (table stack_access). The assignments of a user are cached in socket.stackAccess on login
 * and reloaded by refreshStackAccess() when they change.
 *
 * Stacks are identified by endpoint + name, the endpoint of this instance is "".
 */

export interface StackUser {
    id : number;
    username : string;
    role : string;
}

export function stackKey(endpoint : string, stackName : string) : string {
    // "/" cannot be part of a stack name
    return endpoint + "/" + stackName;
}

/**
 * The endpoint of a request as stored in stack_access ("" for this instance)
 */
export function normalizeEndpoint(socket : DockgeSocket, endpoint : unknown) : string {
    if (typeof(endpoint) !== "string" || endpoint === socket.endpoint) {
        return "";
    }
    return endpoint;
}

export async function loadStackAccess(socket : DockgeSocket) {
    const rows = await R.knex("stack_access").where("user_id", socket.userID).select("endpoint", "stack_name");
    socket.stackAccess = new Set(rows.map((row : { endpoint : string, stack_name : string }) => stackKey(row.endpoint, row.stack_name)));
}

export function canAccessStack(socket : DockgeSocket, endpoint : string, stackName : string) : boolean {
    if (hasRole(socket.userRole, ROLE_ADMIN)) {
        return true;
    }
    return socket.stackAccess?.has(stackKey(endpoint, stackName)) ?? false;
}

export function checkStackAccess(socket : DockgeSocket, endpoint : string, stackName : unknown) {
    if (typeof(stackName) !== "string" || !canAccessStack(socket, endpoint, stackName)) {
        throw new Error("permissionDenied");
    }
}

/**
 * Names of the output terminals (compose and combined logs) of the accessible stacks of an endpoint
 * Interactive terminals are admin only, so they are never included
 */
export function canAccessTerminal(socket : DockgeSocket, endpoint : string, terminalEndpoint : string, terminalName : unknown) : boolean {
    if (hasRole(socket.userRole, ROLE_ADMIN)) {
        return true;
    }
    if (typeof(terminalName) !== "string") {
        return false;
    }
    for (const key of socket.stackAccess ?? []) {
        const separator = key.lastIndexOf("/");
        if (key.substring(0, separator) !== endpoint) {
            continue;
        }
        const stackName = key.substring(separator + 1);
        if (terminalName === getComposeTerminalName(terminalEndpoint, stackName) || terminalName === getCombinedTerminalName(terminalEndpoint, stackName)) {
            return true;
        }
    }
    return false;
}

/**
 * Remove the stacks the user cannot access from a stack list (stackName => stack)
 */
export function filterStackList(socket : DockgeSocket, endpoint : string, stackList : Record<string, unknown>) : Record<string, unknown> {
    if (hasRole(socket.userRole, ROLE_ADMIN)) {
        return stackList;
    }
    const result : Record<string, unknown> = {};
    for (const stackName in stackList) {
        if (canAccessStack(socket, endpoint, stackName)) {
            result[stackName] = stackList[stackName];
        }
    }
    return result;
}

/**
 * Remove the containers of other stacks from `docker stats` (containerName => stats)
 * @param containerProjectMap containerName => compose project, only available for this instance
 */
export function filterDockerStats(socket : DockgeSocket, endpoint : string, dockerStats : Record<string, unknown>, containerProjectMap? : Map<string, string>) : Record<string, unknown> {
    if (hasRole(socket.userRole, ROLE_ADMIN)) {
        return dockerStats;
    }
    const result : Record<string, unknown> = {};
    for (const containerName in dockerStats) {
        let allowed = false;
        if (containerProjectMap) {
            const project = containerProjectMap.get(containerName);
            allowed = project !== undefined && canAccessStack(socket, endpoint, project);
        } else {
            // Remote agent: compose names containers "<project>-<service>-<index>"
            // (a custom container_name is not shown, which is safe)
            for (const key of socket.stackAccess ?? []) {
                const separator = key.lastIndexOf("/");
                if (key.substring(0, separator) === endpoint && containerName.startsWith(key.substring(separator + 1) + "-")) {
                    allowed = true;
                    break;
                }
            }
        }
        if (allowed) {
            result[containerName] = dockerStats[containerName];
        }
    }
    return result;
}

/**
 * @returns containerName => compose project of all containers of this instance
 */
export async function getContainerProjectMap() : Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const res = await childProcessAsync.spawn("docker", [
            "ps", "--all",
            "--filter", "label=com.docker.compose.project",
            "--format", "{{.Names}}|{{.Label \"com.docker.compose.project\"}}",
        ], {
            encoding: "utf-8",
        });
        for (const line of res.stdout?.toString().split("\n") ?? []) {
            const [ name, project ] = line.split("|");
            if (name && project) {
                map.set(name, project);
            }
        }
    } catch (e) {
        log.warn("stack-access", e);
    }
    return map;
}

/**
 * Users assigned to a stack
 */
export async function getStackUsers(endpoint : string, stackName : string) : Promise<StackUser[]> {
    return await R.knex("stack_access")
        .join("user", "user.id", "stack_access.user_id")
        .where("stack_access.endpoint", endpoint)
        .where("stack_access.stack_name", stackName)
        .orderBy("user.username")
        .select("user.id", "user.username", "user.role");
}

/**
 * Users the given user may assign to stacks: an admin assigns operators and viewers, an operator only viewers
 */
export async function getAssignableUsers(socket : DockgeSocket) : Promise<StackUser[]> {
    const roles = hasRole(socket.userRole, ROLE_ADMIN) ? [ ROLE_OPERATOR, ROLE_VIEWER ] : [ ROLE_VIEWER ];
    return await R.knex("user")
        .where("active", 1)
        .whereIn("role", roles)
        .orderBy("username")
        .select("id", "username", "role");
}

export async function addStackAccess(userID : number, endpoint : string, stackName : string) {
    const exists = await R.knex("stack_access")
        .where({
            user_id: userID,
            endpoint,
            stack_name: stackName,
        })
        .first();
    if (!exists) {
        await R.knex("stack_access").insert({
            user_id: userID,
            endpoint,
            stack_name: stackName,
        });
    }
}

/**
 * Called after a stack is deleted
 * @returns IDs of the users who had access
 */
export async function removeStack(endpoint : string, stackName : string) : Promise<number[]> {
    const rows = await R.knex("stack_access").where({
        endpoint,
        stack_name: stackName,
    }).select("user_id");
    await R.knex("stack_access").where({
        endpoint,
        stack_name: stackName,
    }).delete();
    if (endpoint === "") {
        await R.knex("sandbox").where("stack_name", stackName).delete();
    }
    return rows.map((row : { user_id : number }) => row.user_id);
}

/**
 * Reload the stack access of the logged-in sockets of the users and send them the new stack list
 */
export async function refreshStackAccess(server : DockgeServer, userIDs : number[]) {
    const idSet = new Set(userIDs);
    for (const socket of server.io.sockets.sockets.values()) {
        const dockgeSocket = socket as DockgeSocket;
        if (dockgeSocket.userID && idSet.has(dockgeSocket.userID)) {
            await loadStackAccess(dockgeSocket);

            // Stacks of the remote agents are sent by the agents themselves
            dockgeSocket.instanceManager.emitToAllEndpoints("requestStackList", () => {});
        }
    }
    await server.sendStackList(true);
}

/**
 * Names of the local stacks launched from a template
 */
export async function getSandboxNames() : Promise<Set<string>> {
    const rows = await R.knex("sandbox").select("stack_name");
    return new Set(rows.map((row : { stack_name : string }) => row.stack_name));
}
