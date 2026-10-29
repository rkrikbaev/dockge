<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ $t("templates") }}</h1>

            <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                <button v-if="$root.isAdmin && !editing" class="btn btn-primary" @click="editTemplate(null)">
                    <font-awesome-icon icon="plus" class="me-1" />
                    {{ $t("addTemplate") }}
                </button>
                <span v-if="sandboxLimit !== null" class="text-secondary">
                    {{ $t("sandboxCount", [ sandboxCount, sandboxLimit ]) }}
                </span>
            </div>

            <!-- Template Editor (admin), same layout as the stack editor -->
            <div v-if="editing" class="mb-3">
                <div class="mb-3">
                    <div class="btn-group me-2" role="group">
                        <button class="btn btn-primary" :disabled="processing" @click="saveTemplate">
                            <font-awesome-icon icon="save" class="me-1" />
                            {{ $t("Save") }}
                        </button>
                    </div>
                    <div class="btn-group me-2" role="group">
                        <button class="btn btn-normal" :disabled="processing" @click="$refs.importFile.click()">
                            <font-awesome-icon icon="upload" class="me-1" />
                            {{ $t("importStack") }}
                        </button>
                    </div>
                    <button class="btn btn-normal" :disabled="processing" @click="editing = null">{{ $t("cancel") }}</button>
                    <input ref="importFile" type="file" class="d-none" accept=".json,.yaml,.yml,application/json,application/x-yaml,text/yaml" @change="importFile">
                </div>

                <div class="row">
                    <div class="col-lg-6">
                        <h4 class="mb-3">{{ $t("general") }}</h4>
                        <div class="shadow-box big-padding mb-3">
                            <div class="mb-3">
                                <label for="template-name" class="form-label">{{ $t("templateName") }}</label>
                                <input id="template-name" v-model="editing.name" type="text" class="form-control" required @blur="editing.name = editing.name.toLowerCase()">
                                <div class="form-text">{{ $t("templateNameHint") }}</div>
                            </div>
                            <div class="mb-3">
                                <label for="template-description" class="form-label">{{ $t("Description") }}</label>
                                <input id="template-description" v-model="editing.description" type="text" class="form-control">
                            </div>
                            <div>
                                <label class="form-label">{{ $t("templateOperators") }}</label>
                                <div v-if="operatorList.length === 0" class="form-text">{{ $t("templateNoOperators") }}</div>
                                <div v-for="user in operatorList" :key="user.id" class="form-check">
                                    <input :id="'template-operator-' + user.id" v-model="editing.userIDs" class="form-check-input" type="checkbox" :value="user.id">
                                    <label class="form-check-label" :for="'template-operator-' + user.id">{{ user.username }}</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-6">
                        <h4 class="mb-3">compose.yaml</h4>
                        <div class="shadow-box mb-3 editor-box edit-mode">
                            <code-mirror
                                v-model="editing.composeYAML"
                                :extensions="extensions"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                            />
                        </div>

                        <h4 class="mb-3">.env</h4>
                        <div class="shadow-box mb-3 editor-box edit-mode">
                            <code-mirror
                                v-model="editing.composeENV"
                                :extensions="extensionsEnv"
                                minimal
                                wrap="true"
                                dark="true"
                                tab="true"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Template List -->
            <div v-if="!editing && !loading && templateList.length === 0" class="shadow-box big-padding text-secondary">
                {{ $root.isAdmin ? $t("noTemplatesAdmin") : $t("noTemplates") }}
            </div>

            <div v-if="!editing" class="row">
                <div v-for="item in templateList" :key="item.id" class="col-lg-6 mb-3">
                    <div class="shadow-box big-padding h-100 d-flex flex-column">
                        <h5 class="mb-1">{{ item.name }}</h5>
                        <div class="text-secondary mb-3 flex-grow-1">{{ item.description }}</div>

                        <div v-if="$root.isAdmin" class="small text-secondary mb-3">
                            {{ $t("templateOperators") }}: {{ operatorNames(item) || "—" }}
                        </div>

                        <div class="d-flex flex-wrap gap-2">
                            <button class="btn btn-primary" :disabled="processing || limitReached" @click="showLaunch(item)">
                                <font-awesome-icon icon="rocket" class="me-1" />
                                {{ $t("launchTemplate") }}
                            </button>
                            <template v-if="$root.isAdmin">
                                <button class="btn btn-normal" :disabled="processing" @click="editTemplate(item)">
                                    <font-awesome-icon icon="pen" class="me-1" />
                                    {{ $t("editStack") }}
                                </button>
                                <button class="btn btn-danger" :disabled="processing" @click="deleteTarget = item">
                                    <font-awesome-icon icon="trash" class="me-1" />
                                    {{ $t("Delete") }}
                                </button>
                            </template>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Launch Dialog -->
            <BModal :model-value="launchTarget !== null" :title="$t('launchTemplate')" :cancelTitle="$t('cancel')" :okTitle="$t('launchTemplate')" :okDisabled="processing" @update:model-value="launchTarget = null" @ok.prevent="launch">
                <p>{{ $t("launchTemplateMsg", [ launchTarget?.name ]) }}</p>
                <label for="launch-viewer" class="form-label">{{ $t("launchForViewer") }}</label>
                <select id="launch-viewer" v-model="launchViewerID" class="form-select">
                    <option :value="null">{{ $t("launchForNobody") }}</option>
                    <option v-for="user in viewerList" :key="user.id" :value="user.id">{{ user.username }}</option>
                </select>
                <div v-if="processing" class="mt-3 text-secondary">
                    <font-awesome-icon icon="rotate" spin class="me-1" />
                    {{ $t("launchingTemplate") }}
                </div>
            </BModal>

            <!-- Delete Dialog -->
            <BModal :model-value="deleteTarget !== null" :cancelTitle="$t('cancel')" :okTitle="$t('Delete')" okVariant="danger" @update:model-value="deleteTarget = null" @ok="deleteTemplate">
                {{ $t("deleteTemplateMsg", [ deleteTarget?.name ]) }}
            </BModal>
        </div>
    </transition>
</template>

<script>
import { BModal } from "bootstrap-vue-next";
import { parseDocument } from "yaml";
import CodeMirror from "vue-codemirror6";
import { yaml } from "@codemirror/lang-yaml";
import { python } from "@codemirror/lang-python";
import { dracula as editorTheme } from "thememirror";
import { lineNumbers } from "@codemirror/view";

// Same file format as the stack export in Compose.vue
const EXPORT_FORMAT = "dockge-stack";
const IMPORT_MAX_SIZE = 1024 * 1024;

export default {
    components: {
        BModal,
        CodeMirror,
    },
    setup() {
        // Same editors as the stack page
        return {
            extensions: [ editorTheme, yaml(), lineNumbers() ],
            extensionsEnv: [ editorTheme, python(), lineNumbers() ],
        };
    },
    data() {
        return {
            loading: true,
            processing: false,
            templateList: [],
            operatorList: [],
            viewerList: [],
            sandboxCount: 0,
            sandboxLimit: null,
            editing: null,
            launchTarget: null,
            launchViewerID: null,
            deleteTarget: null,
        };
    },
    computed: {
        limitReached() {
            return this.sandboxLimit !== null && this.sandboxCount >= this.sandboxLimit;
        },
    },
    mounted() {
        this.load();

        // "Save as template" from the stack page
        if (this.$root.templateDraft && this.$root.isAdmin) {
            this.editTemplate(null);
            Object.assign(this.editing, this.$root.templateDraft);
            this.$root.templateDraft = null;
        }
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getTemplateList", (res) => {
                this.loading = false;
                if (res.ok) {
                    this.templateList = res.templateList;
                    this.operatorList = res.operatorList;
                    this.viewerList = res.viewerList;
                    this.sandboxCount = res.sandboxCount;
                    this.sandboxLimit = res.sandboxLimit;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        operatorNames(item) {
            return this.operatorList
                .filter((user) => item.userIDs.includes(user.id))
                .map((user) => user.username)
                .join(", ");
        },

        editTemplate(item) {
            this.editing = item ? {
                ...item,
                userIDs: [ ...item.userIDs ],
            } : {
                id: null,
                name: "",
                description: "",
                composeYAML: "",
                composeENV: "",
                userIDs: [],
            };
            window.scrollTo(0, 0);
        },

        saveTemplate() {
            this.processing = true;
            this.$root.getSocket().emit("saveTemplate", this.editing, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.editing = null;
                    this.load();
                }
            });
        },

        deleteTemplate() {
            const id = this.deleteTarget.id;
            this.$root.getSocket().emit("deleteTemplate", id, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.load();
                }
            });
        },

        showLaunch(item) {
            this.launchViewerID = null;
            this.launchTarget = item;
        },

        launch() {
            if (this.processing) {
                return;
            }
            this.processing = true;
            this.$root.getSocket().emit("launchTemplate", this.launchTarget.id, this.launchViewerID, (res) => {
                this.processing = false;
                this.launchTarget = null;
                this.$root.toastRes(res);

                // Also open a stack that failed to start, so the user can see the error
                if (res.stackName) {
                    this.$router.push("/compose/" + res.stackName);
                } else {
                    this.load();
                }
            });
        },

        /**
         * Fill the editor from a file exported from a stack, or a plain compose.yaml
         * @param {Event} event change event of the file input
         */
        async importFile(event) {
            const file = event.target.files[0];
            event.target.value = "";
            if (!file) {
                return;
            }

            try {
                if (file.size > IMPORT_MAX_SIZE) {
                    throw new Error(this.$t("importFileTooLarge"));
                }
                const text = await file.text();
                let composeYAML = text;
                let composeENV;

                if (file.name.toLowerCase().endsWith(".json")) {
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        throw new Error(this.$t("importInvalidFile"));
                    }
                    if (data?.format !== EXPORT_FORMAT || typeof data.composeYAML !== "string") {
                        throw new Error(this.$t("importInvalidFile"));
                    }
                    composeYAML = data.composeYAML;
                    composeENV = typeof data.composeENV === "string" ? data.composeENV : undefined;
                    if (!this.editing.name && typeof data.name === "string") {
                        this.editing.name = data.name.toLowerCase();
                    }
                }

                const doc = parseDocument(composeYAML);
                if (doc.errors.length > 0) {
                    throw doc.errors[0];
                }

                this.editing.composeYAML = composeYAML;
                if (composeENV !== undefined) {
                    this.editing.composeENV = composeENV;
                }
                this.$root.toastSuccess(this.$t("importSuccess", [ file.name ]));
            } catch (e) {
                this.$root.toastError(`${this.$t("importFailed")}: ${e.message}`);
            }
        },
    },
};
</script>

<style scoped lang="scss">
.editor-box {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
}
</style>
