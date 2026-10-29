import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { callbackError, checkLogin, checkRole, DockgeSocket } from "../util-server";
import { AgentSocket } from "../../common/agent-socket";
import { ALL_ENDPOINTS, LooseObject } from "../../common/util-common";
import { getAgentEventRole, hasRole, ROLE_ADMIN, STACK_EVENT_LIST, TERMINAL_EVENT_LIST } from "../../common/roles";
import {
    canAccessTerminal,
    checkStackAccess,
    filterDockerStats,
    getContainerProjectMap,
    getSandboxNames,
    normalizeEndpoint,
    refreshStackAccess,
    removeStack
} from "../stack-access";

export class AgentProxySocketHandler extends SocketHandler {

    create2(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Agent - proxying requests if needed
        socket.on("agent", async (endpoint : unknown, eventName : unknown, ...args : unknown[]) => {
            try {
                checkLogin(socket);

                // Check Type
                if (typeof(endpoint) !== "string") {
                    throw new Error("Endpoint must be a string: " + endpoint);
                }
                if (typeof(eventName) !== "string") {
                    throw new Error("Event name must be a string");
                }

                // Check the permission here, so it is applied to both this instance and remote agents
                // (remote agents only know the agent account, not the actual user)
                try {
                    checkRole(socket, getAgentEventRole(eventName));
                    await this.checkStackPermission(socket, endpoint, eventName, args);
                } catch (e) {
                    log.warn("agent", `User ${socket.userID} (${socket.userRole}) is not allowed to call ${eventName}`);
                    callbackError(e, args[args.length - 1]);
                    return;
                }

                this.wrapCallback(socket, server, endpoint, eventName, args);

                if (endpoint === ALL_ENDPOINTS) {      // Send to all endpoints
                    log.debug("agent", "Sending to all endpoints: " + eventName);
                    socket.instanceManager.emitToAllEndpoints(eventName, ...args);

                } else if (!endpoint || endpoint === socket.endpoint) {      // Direct connection or matching endpoint
                    log.debug("agent", "Matched endpoint: " + eventName);
                    agentSocket.call(eventName, ...args);

                } else {
                    log.debug("agent", "Proxying request to " + endpoint + " for " + eventName);
                    await socket.instanceManager.emitToEndpoint(endpoint, eventName, ...args);
                }
            } catch (e) {
                if (e instanceof Error) {
                    log.warn("agent", e.message);
                }
            }
        });
    }

    /**
     * Operators and viewers can only access the stacks assigned to them, see stack-access.ts
     */
    async checkStackPermission(socket : DockgeSocket, endpoint : string, eventName : string, args : unknown[]) {
        if (hasRole(socket.userRole, ROLE_ADMIN)) {
            return;
        }

        // Only the stack list can be requested from all endpoints (it is filtered per endpoint)
        if (endpoint === ALL_ENDPOINTS) {
            if (eventName !== "requestStackList") {
                throw new Error("permissionDenied");
            }
            return;
        }

        const target = normalizeEndpoint(socket, endpoint);

        if (STACK_EVENT_LIST.includes(eventName)) {
            checkStackAccess(socket, target, args[0]);

            // Operators can only delete the stacks launched from a template
            if (eventName === "deleteStack" && (target !== "" || !(await getSandboxNames()).has(args[0] as string))) {
                throw new Error("permissionDenied");
            }
        } else if (TERMINAL_EVENT_LIST.includes(eventName)) {
            const terminalEndpoint = target === "" ? socket.endpoint : endpoint;
            if (!canAccessTerminal(socket, target, terminalEndpoint, args[0])) {
                throw new Error("permissionDenied");
            }
        }
    }

    /**
     * Change the result of some events before it is sent to the user
     */
    wrapCallback(socket : DockgeSocket, server : DockgeServer, endpoint : string, eventName : string, args : unknown[]) {
        const callback = args[args.length - 1];
        if (typeof(callback) !== "function" || endpoint === ALL_ENDPOINTS) {
            return;
        }
        const target = normalizeEndpoint(socket, endpoint);
        const isAdmin = hasRole(socket.userRole, ROLE_ADMIN);

        if (eventName === "getStack" && !isAdmin) {
            // .env may contain secrets, only admin can read it
            args[args.length - 1] = (res : LooseObject) => {
                if (res?.stack) {
                    res.stack.composeENV = "";
                }
                callback(res);
            };

        } else if (eventName === "dockerStats" && !isAdmin) {
            // docker stats lists the containers of all stacks
            args[args.length - 1] = async (res : LooseObject) => {
                if (res?.dockerStats) {
                    const containerProjectMap = target === "" ? await getContainerProjectMap() : undefined;
                    res.dockerStats = filterDockerStats(socket, target, res.dockerStats, containerProjectMap);
                }
                callback(res);
            };

        } else if (eventName === "deleteStack" && typeof(args[0]) === "string") {
            // Remove the assignments, so a new stack with the same name is not visible to the same users
            const stackName = args[0];
            args[args.length - 1] = async (res : LooseObject) => {
                if (res?.ok) {
                    try {
                        const userIDs = await removeStack(target, stackName);
                        await refreshStackAccess(server, userIDs);
                    } catch (e) {
                        log.error("agent", e);
                    }
                }
                callback(res);
            };
        }
    }

    create(socket : DockgeSocket, server : DockgeServer) {
        throw new Error("Method not implemented. Please use create2 instead.");
    }
}
