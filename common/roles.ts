/*
 * User roles and permissions
 * Shared by the backend (enforcement) and the frontend (hiding controls the user cannot use)
 */

export const ROLE_ADMIN = "admin";
export const ROLE_OPERATOR = "operator";
export const ROLE_VIEWER = "viewer";

export type Role = typeof ROLE_ADMIN | typeof ROLE_OPERATOR | typeof ROLE_VIEWER;

export const ROLE_LIST : Role[] = [ ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER ];

const ROLE_LEVEL : Record<Role, number> = {
    [ROLE_VIEWER]: 1,
    [ROLE_OPERATOR]: 2,
    [ROLE_ADMIN]: 3,
};

export function isValidRole(role : unknown) : role is Role {
    return typeof(role) === "string" && ROLE_LIST.includes(role as Role);
}

/**
 * Check if a role is at least as privileged as the required role
 * Unknown roles have no permission at all
 * @param role The role of the user
 * @param requiredRole The minimum role required
 */
export function hasRole(role : unknown, requiredRole : Role) : boolean {
    if (!isValidRole(role)) {
        return false;
    }
    return ROLE_LEVEL[role] >= ROLE_LEVEL[requiredRole];
}

/**
 * Minimum role required for each agent event (see backend/agent-socket-handlers)
 * Events that are not listed here require admin
 */
export const AGENT_EVENT_ROLE : Record<string, Role> = {
    // Read-only
    requestStackList: ROLE_VIEWER,
    getStack: ROLE_VIEWER,
    serviceStatusList: ROLE_VIEWER,
    dockerStats: ROLE_VIEWER,
    getDockerNetworkList: ROLE_VIEWER,
    checkMainTerminal: ROLE_VIEWER,
    terminalJoin: ROLE_VIEWER,      // Interactive terminals are additionally restricted to admin in the handler
    leaveCombinedTerminal: ROLE_VIEWER,
    terminalResize: ROLE_VIEWER,

    // Operate existing stacks
    startStack: ROLE_OPERATOR,
    stopStack: ROLE_OPERATOR,
    restartStack: ROLE_OPERATOR,
    updateStack: ROLE_OPERATOR,
    downStack: ROLE_OPERATOR,
    startService: ROLE_OPERATOR,
    stopService: ROLE_OPERATOR,
    restartService: ROLE_OPERATOR,

    // Operators can only delete stacks launched from a template, checked in the agent proxy
    deleteStack: ROLE_OPERATOR,

    // Admin only
    deployStack: ROLE_ADMIN,
    saveStack: ROLE_ADMIN,
    interactiveTerminal: ROLE_ADMIN,
    mainTerminal: ROLE_ADMIN,
    terminalInput: ROLE_ADMIN,
};

export function getAgentEventRole(eventName : string) : Role {
    return AGENT_EVENT_ROLE[eventName] ?? ROLE_ADMIN;
}

/**
 * Agent events with a stack name as the first argument
 * Operators and viewers can only call them for the stacks assigned to them
 */
export const STACK_EVENT_LIST = [
    "getStack",
    "serviceStatusList",
    "startStack",
    "stopStack",
    "restartStack",
    "updateStack",
    "downStack",
    "deleteStack",
    "startService",
    "stopService",
    "restartService",
    "leaveCombinedTerminal",
    "interactiveTerminal",
];

/**
 * Agent events with a terminal name as the first argument
 */
export const TERMINAL_EVENT_LIST = [
    "terminalJoin",
    "terminalResize",
];
