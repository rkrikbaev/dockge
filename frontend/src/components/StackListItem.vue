<template>
    <router-link :to="url" :class="{ 'dim' : !stack.isManagedByDockge }" class="item">
        <Uptime :stack="stack" :fixed-width="true" class="me-2" />
        <div class="title" :title="stackName">
            <span>{{ stackName }}</span>
            <font-awesome-icon v-if="stack.isSandbox" icon="layer-group" class="ms-2 text-secondary" :title="$t('sandbox')" />
        </div>

        <!-- Published ports. Not <a>, because links cannot be nested inside the router-link -->
        <div v-if="portList.length > 0" class="ports">
            <span
                v-for="port in visiblePortList"
                :key="port.display"
                class="badge bg-secondary port"
                role="link"
                tabindex="0"
                :title="$t('openInBrowser', [ port.url ])"
                @click.prevent.stop="openPort(port)"
                @keydown.enter.prevent.stop="openPort(port)"
            >{{ port.display }}</span>
            <span v-if="portList.length > visiblePortList.length" class="badge bg-secondary more" :title="hiddenPortTitle">
                +{{ portList.length - visiblePortList.length }}
            </span>
        </div>
    </router-link>
</template>

<script>
import Uptime from "./Uptime.vue";
import { parseDockerPort } from "../../../common/util-common";

const MAX_VISIBLE_PORTS = 3;

export default {
    components: {
        Uptime
    },
    props: {
        /** Stack this represents */
        stack: {
            type: Object,
            default: null,
        },
        /** If the user is in select mode */
        isSelectMode: {
            type: Boolean,
            default: false,
        },
        /** How many ancestors are above this stack */
        depth: {
            type: Number,
            default: 0,
        },
        /** Callback to determine if stack is selected */
        isSelected: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is selected */
        select: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when stack is deselected */
        deselect: {
            type: Function,
            default: () => {}
        },
    },
    data() {
        return {
            isCollapsed: true,
        };
    },
    computed: {
        endpointDisplay() {
            return this.$root.endpointDisplayFunction(this.stack.endpoint);
        },
        url() {
            if (this.stack.endpoint) {
                return `/compose/${this.stack.name}/${this.stack.endpoint}`;
            } else {
                return `/compose/${this.stack.name}`;
            }
        },
        depthMargin() {
            return {
                marginLeft: `${31 * this.depth}px`,
            };
        },
        stackName() {
            return this.stack.name;
        },

        /**
         * Host to open the ports on: the configured primary hostname or the current host,
         * for remote agents the host of the agent
         */
        portHostname() {
            if (this.stack.endpoint) {
                return this.stack.endpoint.replace(/:\d+$/, "");
            }
            return this.$root.info.primaryHostname || location.hostname;
        },

        portList() {
            return (this.stack.ports ?? []).map((port) => parseDockerPort(port, this.portHostname));
        },

        visiblePortList() {
            return this.portList.slice(0, MAX_VISIBLE_PORTS);
        },

        hiddenPortTitle() {
            return this.portList.slice(MAX_VISIBLE_PORTS).map((port) => port.display).join(", ");
        },
    },
    watch: {
        isSelectMode() {
            // TODO: Resize the heartbeat bar, but too slow
            // this.$refs.heartbeatBar.resize();
        }
    },
    beforeMount() {

    },
    methods: {
        openPort(port) {
            window.open(port.url, "_blank", "noopener");
        },

        /**
         * Changes the collapsed value of the current stack and saves
         * it to local storage
         * @returns {void}
         */
        changeCollapsed() {
            this.isCollapsed = !this.isCollapsed;

            // Save collapsed value into local storage
            let storage = window.localStorage.getItem("stackCollapsed");
            let storageObject = {};
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }
            storageObject[`stack_${this.stack.id}`] = this.isCollapsed;

            window.localStorage.setItem("stackCollapsed", JSON.stringify(storageObject));
        },

        /**
         * Toggle selection of stack
         * @returns {void}
         */
        toggleSelection() {
            if (this.isSelected(this.stack.id)) {
                this.deselect(this.stack.id);
            } else {
                this.select(this.stack.id);
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../styles/vars.scss";

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.collapse-padding {
    padding-left: 8px !important;
    padding-right: 2px !important;
}

.item {
    text-decoration: none;
    display: flex;
    align-items: center;
    min-height: 52px;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    width: 100%;
    padding: 5px 8px;
    &.disabled {
        opacity: 0.3;
    }
    &:hover {
        background-color: $highlight-white;
    }
    &.active {
        background-color: #cdf8f4;
    }
    .title {
        margin-top: -4px;

        // Long names (e.g. stacks launched from a template) are cut, the full name is in the tooltip
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .endpoint {
        font-size: 12px;
        color: $dark-font-color3;
    }
}

.collapsed {
    transform: rotate(-90deg);
}

.animated {
    transition: all 0.2s $easing-in;
}

.select-input-wrapper {
    float: left;
    margin-top: 15px;
    margin-left: 3px;
    margin-right: 10px;
    padding-left: 4px;
    position: relative;
    z-index: 15;
}

.dim {
    opacity: 0.5;
}

.ports {
    flex-shrink: 0;
    margin-left: auto;
    padding-left: 8px;
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 4px;

    .badge {
        font-size: 11px;
    }

    .port {
        cursor: pointer;

        &:hover {
            background-color: $primary !important;
            color: #000;
        }
    }
}

</style>
