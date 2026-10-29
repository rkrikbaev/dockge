import path from "path";
import yaml from "yaml";
import dayjs from "dayjs";
import { R } from "redbean-node";
import { SocketHandler } from "../socket-handler.js";
import { DockgeServer } from "../dockge-server";
import { log } from "../log";
import { callbackError, callbackResult, checkAdmin, checkRole, DockgeSocket, fileExists, ValidationError } from "../util-server";
import { LooseObject } from "../../common/util-common";
import { hasRole, ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER } from "../../common/roles";
import { Stack } from "../stack";
import { addStackAccess, refreshStackAccess } from "../stack-access";

/**
 * Stack templates (sandboxes)
 *
 * An admin prepares templates and chooses the operators who can launch them.
 * An operator launches a template as a new stack (a sandbox), optionally for a viewer,
 * and can delete the sandbox when the work is done. An operator can run at most
 * SANDBOX_LIMIT sandboxes at the same time, admins have no limit.
 */

const SANDBOX_LIMIT = Number(process.env.DOCKGE_SANDBOX_LIMIT) || 2;

// Leaves room for "-<user>-<YYYYMMDD-HHmmss>" in the stack name
const TEMPLATE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export class TemplateSocketHandler extends SocketHandler {

    // Users with a launch in progress, so the limit cannot be bypassed by launching twice at once
    launchingUsers : Set<number> = new Set();

    create(socket : DockgeSocket, server : DockgeServer) {

        socket.on("getTemplateList", async (callback : unknown) => {
            try {
                checkRole(socket, ROLE_OPERATOR);
                const isAdmin = hasRole(socket.userRole, ROLE_ADMIN);

                let templateList;
                if (isAdmin) {
                    const accessList = await R.knex("template_access").select("template_id", "user_id");
                    templateList = (await R.knex("stack_template").orderBy("name").select()).map((row : LooseObject) => ({
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        composeYAML: row.compose_yaml,
                        composeENV: row.compose_env,
                        userIDs: accessList
                            .filter((access : LooseObject) => access.template_id === row.id)
                            .map((access : LooseObject) => access.user_id),
                    }));
                } else {
                    // Operators cannot read the compose file and .env of a template
                    templateList = await R.knex("stack_template")
                        .join("template_access", "template_access.template_id", "stack_template.id")
                        .where("template_access.user_id", socket.userID)
                        .orderBy("stack_template.name")
                        .select("stack_template.id", "stack_template.name", "stack_template.description");
                }

                callbackResult({
                    ok: true,
                    templateList,
                    operatorList: isAdmin ? await this.getUserList(ROLE_OPERATOR) : [],
                    viewerList: await this.getUserList(ROLE_VIEWER),
                    sandboxCount: (await this.getSandboxList(server, socket.userID)).length,
                    sandboxLimit: isAdmin ? null : SANDBOX_LIMIT,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("saveTemplate", async (requestData : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);

                if (typeof(requestData) !== "object" || requestData === null) {
                    throw new ValidationError("Data must be an object");
                }
                const data = requestData as LooseObject;

                if (typeof(data.name) !== "string" || !TEMPLATE_NAME_REGEX.test(data.name)) {
                    throw new ValidationError("invalidTemplateName");
                }
                if (typeof(data.description) !== "string" || typeof(data.composeYAML) !== "string" || typeof(data.composeENV) !== "string") {
                    throw new ValidationError("Description, compose YAML and .env must be strings");
                }
                if (!Array.isArray(data.userIDs) || !data.userIDs.every((id : unknown) => typeof(id) === "number")) {
                    throw new ValidationError("User IDs must be an array of numbers");
                }
                if (data.id !== undefined && data.id !== null && typeof(data.id) !== "number") {
                    throw new ValidationError("Template ID must be a number");
                }

                // Same checks as a stack, so a launch does not fail because of the template
                new Stack(server, data.name, data.composeYAML, data.composeENV, true).validate();
                if (!yaml.parse(data.composeYAML)?.services) {
                    throw new ValidationError("templateHasNoServices");
                }

                const duplicate = await R.knex("stack_template").where("name", data.name).first();
                if (duplicate && duplicate.id !== data.id) {
                    throw new ValidationError("templateNameAlreadyExists");
                }

                const row = {
                    name: data.name,
                    description: data.description,
                    compose_yaml: data.composeYAML,
                    compose_env: data.composeENV,
                };

                let id : number;
                if (data.id) {
                    if (!await R.knex("stack_template").where("id", data.id).first()) {
                        throw new ValidationError("templateNotFound");
                    }
                    await R.knex("stack_template").where("id", data.id).update(row);
                    id = data.id;
                } else {
                    [ id ] = await R.knex("stack_template").insert(row);
                }

                // Only operators can launch templates
                const operatorIDs = new Set((await this.getUserList(ROLE_OPERATOR)).map((user) => user.id));
                await R.knex("template_access").where("template_id", id).delete();
                for (const userID of new Set(data.userIDs as number[])) {
                    if (operatorIDs.has(userID)) {
                        await R.knex("template_access").insert({
                            template_id: id,
                            user_id: userID,
                        });
                    }
                }

                log.info("template", `User ${socket.userID} saved template ${data.name}`);

                callbackResult({
                    ok: true,
                    msg: "templateSaved",
                    msgi18n: true,
                    id,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("deleteTemplate", async (id : unknown, callback : unknown) => {
            try {
                checkAdmin(socket);
                if (typeof(id) !== "number") {
                    throw new ValidationError("Template ID must be a number");
                }

                // Sandboxes launched from the template are kept
                await R.knex("template_access").where("template_id", id).delete();
                await R.knex("stack_template").where("id", id).delete();

                log.info("template", `User ${socket.userID} deleted template ${id}`);

                callbackResult({
                    ok: true,
                    msg: "templateDeleted",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        socket.on("launchTemplate", async (templateID : unknown, viewerID : unknown, callback : unknown) => {
            let stackName : string | undefined;
            const userID = socket.userID;

            try {
                checkRole(socket, ROLE_OPERATOR);
                const isAdmin = hasRole(socket.userRole, ROLE_ADMIN);

                if (typeof(templateID) !== "number") {
                    throw new ValidationError("Template ID must be a number");
                }
                if (viewerID !== null && typeof(viewerID) !== "number") {
                    throw new ValidationError("Viewer ID must be a number or null");
                }

                const template = await R.knex("stack_template").where("id", templateID).first();
                if (!template) {
                    throw new ValidationError("templateNotFound");
                }
                if (!isAdmin && !await R.knex("template_access").where({
                    template_id: templateID,
                    user_id: userID,
                }).first()) {
                    throw new Error("permissionDenied");
                }

                let viewer;
                if (viewerID !== null) {
                    viewer = await R.knex("user").where({
                        id: viewerID,
                        role: ROLE_VIEWER,
                        active: 1,
                    }).first();
                    if (!viewer) {
                        throw new ValidationError("userNotFound");
                    }
                }

                if (this.launchingUsers.has(userID)) {
                    throw new ValidationError("sandboxLaunchInProgress");
                }
                this.launchingUsers.add(userID);

                try {
                    if (!isAdmin && (await this.getSandboxList(server, userID)).length >= SANDBOX_LIMIT) {
                        throw new ValidationError("sandboxLimitReached");
                    }

                    const user = await R.knex("user").where("id", userID).first();
                    stackName = await this.generateStackName(server, template.name, viewer?.username ?? user.username, userID);

                    const stack = new Stack(server, stackName, template.compose_yaml, template.compose_env);
                    await stack.save(true);

                    await R.knex("sandbox").insert({
                        stack_name: stackName,
                        template_id: template.id,
                        created_by: userID,
                    });

                    // Admins see all stacks anyway
                    const userIDs : number[] = [];
                    if (!isAdmin) {
                        userIDs.push(userID);
                    }
                    if (viewer) {
                        userIDs.push(viewer.id);
                    }
                    for (const id of userIDs) {
                        await addStackAccess(id, "", stackName);
                    }
                    await refreshStackAccess(server, userIDs);
                } finally {
                    this.launchingUsers.delete(userID);
                }

                log.info("template", `User ${userID} launched ${stackName} from template ${template.name}`);

                const stack = await Stack.getStack(server, stackName);
                await stack.deploy(socket);
                server.sendStackList();
                stack.joinCombinedTerminal(socket);

                callbackResult({
                    ok: true,
                    msg: "Deployed",
                    msgi18n: true,
                    stackName,
                }, callback);
            } catch (e) {
                if (stackName) {
                    // The stack is created, but failed to start. The user can see the error in the stack page.
                    server.sendStackList();
                    callbackResult({
                        ok: false,
                        msg: e instanceof Error ? e.message : String(e),
                        stackName,
                    }, callback);
                } else {
                    callbackError(e, callback);
                }
            }
        });
    }

    async getUserList(role : string) : Promise<{ id : number, username : string }[]> {
        return await R.knex("user").where({
            role,
            active: 1,
        }).orderBy("username").select("id", "username");
    }

    /**
     * Sandboxes launched by a user which still exist
     * Sandboxes deleted outside Dockge are removed from the list
     */
    async getSandboxList(server : DockgeServer, userID : number) : Promise<string[]> {
        const result : string[] = [];
        for (const row of await R.knex("sandbox").where("created_by", userID).select("stack_name")) {
            if (await fileExists(path.join(server.stacksDir, row.stack_name))) {
                result.push(row.stack_name);
            } else {
                await R.knex("sandbox").where("stack_name", row.stack_name).delete();
            }
        }
        return result;
    }

    /**
     * <template>-<user>-<YYYYMMDD-HHmmss>, e.g. faceplate-ivan-20261029-143005
     */
    async generateStackName(server : DockgeServer, templateName : string, username : string, userID : number) : Promise<string> {
        let user = username.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 20);
        if (!user) {
            user = "user" + userID;
        }

        const base = `${templateName}-${user}-${dayjs().format("YYYYMMDD-HHmmss")}`;
        let name = base;
        for (let i = 2; await fileExists(path.join(server.stacksDir, name)); i++) {
            name = `${base}-${i}`;
        }
        return name;
    }
}
