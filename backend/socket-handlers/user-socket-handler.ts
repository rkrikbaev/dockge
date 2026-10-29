import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { R } from "redbean-node";
import { passwordStrength } from "check-password-strength";
import { callbackError, callbackResult, checkAdmin, DockgeSocket, ValidationError } from "../util-server";
import { generatePasswordHash } from "../password-hash";
import { LooseObject } from "../../common/util-common";
import { isValidRole } from "../../common/roles";

/**
 * User management (admin only)
 *
 * An admin cannot change the role of, deactivate or delete their own account,
 * so there is always at least one active admin.
 */
export class UserSocketHandler extends SocketHandler {
    create(socket : DockgeSocket, server : DockgeServer) {

        socket.on("getUserList", async (callback : unknown) => {
            try {
                checkAdmin(socket);
                callbackResult({
                    ok: true,
                    userList: await this.getUserList(),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("addUser", async (requestData : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);

                if (typeof(requestData) !== "object" || requestData === null) {
                    throw new ValidationError("Data must be an object");
                }
                const data = requestData as LooseObject;

                const username = this.validateUsername(data.username);
                this.validatePassword(data.password);
                if (!isValidRole(data.role)) {
                    throw new ValidationError("invalidRole");
                }

                if (await R.findOne("user", " username = ? ", [ username ])) {
                    throw new ValidationError("usernameAlreadyExists");
                }

                const user = R.dispense("user");
                user.username = username;
                user.password = generatePasswordHash(data.password);
                user.role = data.role;
                user.active = true;
                await R.store(user);

                log.info("user", `User ${socket.userID} added user ${username} (${data.role})`);

                callbackResult({
                    ok: true,
                    msg: "userAddedSuccessfully",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("updateUser", async (requestData : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);

                if (typeof(requestData) !== "object" || requestData === null) {
                    throw new ValidationError("Data must be an object");
                }
                const data = requestData as LooseObject;
                const user = await this.getUser(data.id);
                const isSelf = user.id === socket.userID;

                if (data.role !== undefined && data.role !== user.role) {
                    if (!isValidRole(data.role)) {
                        throw new ValidationError("invalidRole");
                    }
                    if (isSelf) {
                        throw new ValidationError("cannotModifyOwnAccount");
                    }
                    user.role = data.role;
                }

                if (data.active !== undefined && Boolean(data.active) !== Boolean(user.active)) {
                    if (isSelf) {
                        throw new ValidationError("cannotModifyOwnAccount");
                    }
                    user.active = Boolean(data.active);
                }

                // Password reset by admin (the user changes their own password in Settings > Security)
                if (data.password) {
                    this.validatePassword(data.password);
                    user.password = generatePasswordHash(data.password);
                }

                await R.store(user);

                log.info("user", `User ${socket.userID} updated user ${user.username}`);

                // Force the user to log in again, so the new role / status / password takes effect
                if (!isSelf) {
                    server.disconnectAllSocketClients(user.id);
                }

                callbackResult({
                    ok: true,
                    msg: "userUpdatedSuccessfully",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("deleteUser", async (id : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);

                const user = await this.getUser(id);
                if (user.id === socket.userID) {
                    throw new ValidationError("cannotModifyOwnAccount");
                }

                // R.trash() clears the id, and disconnectAllSocketClients(undefined) would disconnect everyone
                const userID = user.id;
                const username = user.username;
                await R.trash(user);
                await R.knex("stack_access").where("user_id", userID).delete();
                await R.knex("template_access").where("user_id", userID).delete();
                server.disconnectAllSocketClients(userID);

                log.info("user", `User ${socket.userID} deleted user ${username}`);

                callbackResult({
                    ok: true,
                    msg: "userDeletedSuccessfully",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    async getUserList() {
        const list = await R.find("user", " 1 = 1 ORDER BY username ");
        return list.map((user) => {
            return {
                id: user.id,
                username: user.username,
                role: user.role,
                active: Boolean(user.active),
            };
        });
    }

    async getUser(id : unknown) {
        if (typeof(id) !== "number") {
            throw new ValidationError("User ID must be a number");
        }
        const user = await R.findOne("user", " id = ? ", [ id ]);
        if (!user) {
            throw new ValidationError("userNotFound");
        }
        return user;
    }

    validateUsername(username : unknown) : string {
        if (typeof(username) !== "string" || username.trim() === "") {
            throw new ValidationError("usernameRequired");
        }
        return username.trim();
    }

    validatePassword(password : unknown) {
        if (typeof(password) !== "string" || passwordStrength(password).value === "Too weak") {
            throw new ValidationError("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
        }
    }
}
