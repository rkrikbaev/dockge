import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { R } from "redbean-node";
import { callbackError, callbackResult, checkRole, DockgeSocket, ValidationError } from "../util-server";
import { ROLE_OPERATOR } from "../../common/roles";
import {
    addStackAccess,
    checkStackAccess,
    getAssignableUsers,
    getStackUsers,
    normalizeEndpoint,
    refreshStackAccess
} from "../stack-access";

/**
 * Assign stacks to users
 *
 * An admin assigns operators and viewers, an operator assigns viewers to the stacks assigned to the operator.
 */
export class StackAccessSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        socket.on("getStackAccess", async (endpoint : unknown, stackName : unknown, callback : unknown) => {
            try {
                checkRole(socket, ROLE_OPERATOR);
                const target = this.getEndpoint(socket, endpoint);
                checkStackAccess(socket, target, stackName);

                callbackResult({
                    ok: true,
                    userList: await getStackUsers(target, stackName as string),
                    assignableUserList: await getAssignableUsers(socket),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("setStackAccess", async (endpoint : unknown, stackName : unknown, userIDs : unknown, callback : unknown) => {
            try {
                checkRole(socket, ROLE_OPERATOR);
                const target = this.getEndpoint(socket, endpoint);
                checkStackAccess(socket, target, stackName);
                const name = stackName as string;

                // Same rule as compose project names
                if (!/^[a-z0-9_-]+$/.test(name)) {
                    throw new ValidationError("Invalid stack name");
                }

                if (!Array.isArray(userIDs) || !userIDs.every((id) => typeof(id) === "number")) {
                    throw new ValidationError("User IDs must be an array of numbers");
                }

                // Only the users the caller may assign are changed, the others are kept
                const assignable = new Set((await getAssignableUsers(socket)).map((user) => user.id));
                const current = new Set((await getStackUsers(target, name)).map((user) => user.id));
                const wanted = new Set((userIDs as number[]).filter((id) => assignable.has(id)));

                const changed : number[] = [];
                for (const id of wanted) {
                    if (!current.has(id)) {
                        await addStackAccess(id, target, name);
                        changed.push(id);
                    }
                }
                for (const id of current) {
                    if (assignable.has(id) && !wanted.has(id)) {
                        await R.knex("stack_access").where({
                            user_id: id,
                            endpoint: target,
                            stack_name: name,
                        }).delete();
                        changed.push(id);
                    }
                }

                log.info("stack-access", `User ${socket.userID} changed the access of ${target}/${name}: ${[ ...wanted ].join(",")}`);
                await refreshStackAccess(server, changed);

                callbackResult({
                    ok: true,
                    msg: "stackAccessSaved",
                    msgi18n: true,
                    userList: await getStackUsers(target, name),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    getEndpoint(socket : DockgeSocket, endpoint : unknown) : string {
        if (typeof(endpoint) !== "string" || endpoint.length > 255) {
            throw new ValidationError("Endpoint must be a string");
        }
        return normalizeEndpoint(socket, endpoint);
    }
}
