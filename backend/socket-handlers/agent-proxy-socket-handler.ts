import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { callbackError, checkLogin, checkRole, DockgeSocket } from "../util-server";
import { AgentSocket } from "../../common/agent-socket";
import { ALL_ENDPOINTS, LooseObject } from "../../common/util-common";
import { getAgentEventRole, hasRole, ROLE_ADMIN } from "../../common/roles";

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
                } catch (e) {
                    log.warn("agent", `User ${socket.userID} (${socket.userRole}) is not allowed to call ${eventName}`);
                    callbackError(e, args[args.length - 1]);
                    return;
                }

                // .env may contain secrets, only admin can read it
                if (eventName === "getStack" && !hasRole(socket.userRole, ROLE_ADMIN)) {
                    const callback = args[args.length - 1];
                    if (typeof(callback) === "function") {
                        args[args.length - 1] = (res : LooseObject) => {
                            if (res?.stack) {
                                res.stack.composeENV = "";
                            }
                            callback(res);
                        };
                    }
                }

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

    create(socket : DockgeSocket, server : DockgeServer) {
        throw new Error("Method not implemented. Please use create2 instead.");
    }
}
