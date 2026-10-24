<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ $t("containerFiles") }} - {{ serviceName }} ({{ stackName }})</h1>

            <!-- Toolbar -->
            <div class="d-flex flex-wrap gap-2 mb-3">
                <button class="btn btn-normal" :title="$t('parentDirectory')" :disabled="loading || currentPath === '/'" @click="openPath(parentPath)">
                    <font-awesome-icon icon="arrow-up" />
                </button>
                <button class="btn btn-normal" :title="$t('refresh')" :disabled="loading" @click="openPath(currentPath)">
                    <font-awesome-icon icon="rotate" :spin="loading" />
                </button>
                <form class="flex-grow-1 path-form" @submit.prevent="openPath(pathInput)">
                    <input v-model="pathInput" class="form-control" spellcheck="false" />
                </form>
                <button class="btn btn-primary" :disabled="loading || uploading" @click="$refs.uploadFile.click()">
                    <font-awesome-icon icon="upload" class="me-1" />
                    {{ $t("uploadFiles") }}
                </button>
                <input ref="uploadFile" type="file" class="d-none" multiple @change="uploadFiles">
            </div>

            <!-- Upload progress -->
            <div v-if="uploading" class="mb-3">
                <div class="small mb-1">{{ $t("uploadingFile", [ uploading.name, uploading.index, uploading.total ]) }}</div>
                <div class="progress">
                    <div class="progress-bar" :style="{ width: uploading.percent + '%' }">{{ uploading.percent }}%</div>
                </div>
            </div>

            <!-- File List -->
            <div class="shadow-box big-padding">
                <div v-if="error" class="text-danger">{{ error }}</div>
                <div v-else-if="!loading && entries.length === 0" class="text-secondary">{{ $t("emptyDirectory") }}</div>

                <div v-if="entries.length > 0" class="table-responsive">
                    <table class="table align-middle file-table mb-0">
                        <thead>
                            <tr>
                                <th>{{ $t("fileName") }}</th>
                                <th class="text-end">{{ $t("fileSize") }}</th>
                                <th>{{ $t("fileModified") }}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="entry in entries" :key="entry.name">
                                <td class="file-name">
                                    <font-awesome-icon :icon="entry.isDirectory ? 'folder' : 'file'" class="me-2 file-icon" :class="{ directory: entry.isDirectory }" />
                                    <a v-if="entry.isDirectory" href="#" @click.prevent="openPath(join(currentPath, entry.name))">{{ entry.name }}</a>
                                    <span v-else>{{ entry.name }}</span>
                                    <font-awesome-icon v-if="entry.isSymlink" icon="link" class="ms-2 text-secondary" :title="$t('symlink')" />
                                </td>
                                <td class="text-end text-nowrap">{{ entry.isDirectory ? "" : formatSize(entry.size) }}</td>
                                <td class="text-nowrap">{{ formatTime(entry.mtime) }}</td>
                                <td class="text-end">
                                    <button
                                        class="btn btn-sm btn-normal"
                                        :title="entry.isDirectory ? $t('downloadDirectory') : $t('downloadFile')"
                                        @click="download(entry)"
                                    >
                                        <font-awesome-icon icon="download" />
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div v-if="truncated" class="small text-secondary mt-2">{{ $t("directoryTruncated") }}</div>
            </div>
        </div>
    </transition>
</template>

<script>
import dayjs from "dayjs";

export default {
    data() {
        return {
            currentPath: "/",
            pathInput: "/",
            entries: [],
            truncated: false,
            loading: false,
            error: "",
            uploading: null,
        };
    },
    computed: {
        stackName() {
            return this.$route.params.stackName;
        },
        serviceName() {
            return this.$route.params.serviceName;
        },
        parentPath() {
            const parts = this.currentPath.split("/").filter((part) => part !== "");
            parts.pop();
            return "/" + parts.join("/");
        },
    },
    watch: {
        // The socket may not be logged in yet after a page reload
        "$root.loggedIn"(loggedIn) {
            if (loggedIn) {
                this.openPath(this.currentPath);
            }
        },
    },
    mounted() {
        if (this.$root.loggedIn) {
            this.openPath(this.currentPath);
        }
    },
    methods: {
        join(dir, name) {
            return (dir.endsWith("/") ? dir : dir + "/") + name;
        },

        openPath(path) {
            this.loading = true;
            this.$root.getSocket().emit("listContainerFiles", this.stackName, this.serviceName, path, (res) => {
                this.loading = false;
                if (res.ok) {
                    this.currentPath = res.path;
                    this.pathInput = res.path;
                    this.entries = res.entries;
                    this.truncated = res.truncated;
                    this.error = "";
                } else {
                    this.pathInput = this.currentPath;
                    // Keep the current list if only the new path failed
                    if (this.entries.length > 0) {
                        this.$root.toastRes(res);
                    } else {
                        this.error = res.msgi18n ? this.$t(res.msg) : res.msg;
                    }
                }
            });
        },

        download(entry) {
            const path = this.join(this.currentPath, entry.name);
            this.$root.getSocket().emit("createContainerFileDownload", this.stackName, this.serviceName, path, (res) => {
                if (res.ok) {
                    // Served with "Content-Disposition: attachment", so the page stays
                    window.location.href = this.$root.backendURL() + res.url;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        async uploadFiles(event) {
            const files = [ ...event.target.files ];

            // Reset, so the same file can be selected again
            event.target.value = "";

            const existing = files.filter((file) => this.entries.some((entry) => entry.name === file.name));
            if (existing.length > 0 && !confirm(this.$t("confirmOverwriteFiles", [ existing.map((file) => file.name).join(", ") ]))) {
                return;
            }

            let index = 0;
            for (const file of files) {
                index++;
                this.uploading = {
                    name: file.name,
                    index,
                    total: files.length,
                    percent: 0,
                };
                try {
                    await this.uploadFile(file);
                    this.$root.toastSuccess(this.$t("fileUploaded", [ file.name ]));
                } catch (e) {
                    this.$root.toastError(`${file.name}: ${e.message}`);
                }
            }

            this.uploading = null;
            this.openPath(this.currentPath);
        },

        uploadFile(file) {
            return new Promise((resolve, reject) => {
                this.$root.getSocket().emit("createContainerFileUpload", this.stackName, this.serviceName, this.currentPath, file.name, file.size, (res) => {
                    if (!res.ok) {
                        reject(new Error(res.msgi18n ? this.$t(res.msg) : res.msg));
                        return;
                    }

                    // XMLHttpRequest instead of fetch() for the upload progress
                    const xhr = new XMLHttpRequest();
                    xhr.open("PUT", this.$root.backendURL() + res.url);
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            this.uploading.percent = Math.floor(e.loaded / e.total * 100);
                        }
                    };
                    xhr.onload = () => {
                        let result;
                        try {
                            result = JSON.parse(xhr.responseText);
                        } catch (e) {
                            result = {
                                ok: false,
                                msg: xhr.statusText,
                            };
                        }
                        if (result.ok) {
                            resolve();
                        } else {
                            reject(new Error(result.msg));
                        }
                    };
                    xhr.onerror = () => reject(new Error(this.$t("uploadFailed")));
                    xhr.send(file);
                });
            });
        },

        formatSize(size) {
            const units = [ "B", "KB", "MB", "GB", "TB" ];
            let i = 0;
            while (size >= 1024 && i < units.length - 1) {
                size /= 1024;
                i++;
            }
            return (i === 0 ? size : size.toFixed(1)) + " " + units[i];
        },

        formatTime(mtime) {
            return mtime ? dayjs.unix(mtime).format("YYYY-MM-DD HH:mm") : "";
        },
    },
};
</script>

<style scoped lang="scss">
@import "../styles/vars.scss";

// Follow the page background / text color in both light and dark theme
.file-table {
    --bs-table-bg: transparent;
    --bs-table-color: inherit;
    --bs-table-border-color: rgba(128, 128, 128, 0.25);
}

.file-name {
    word-break: break-all;
}

.file-icon {
    color: #888;

    &.directory {
        color: $primary;
    }
}

.path-form {
    min-width: 200px;
}
</style>
