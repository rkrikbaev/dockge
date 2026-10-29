<template>
    <div>
        <h4 class="mb-3">{{ $t("stackAccess") }}</h4>
        <div class="shadow-box big-padding mb-3">
            <div class="small text-secondary mb-2">{{ $t("stackAccessDescription") }}</div>

            <div v-if="userList.length === 0" class="mb-3">{{ $t("stackAccessNobody") }}</div>
            <div v-else class="mb-3">
                <span v-for="user in userList" :key="user.id" class="badge user-badge me-2 mb-1">
                    {{ user.username }}
                    <span class="role">({{ $t("role_" + user.role) }})</span>
                    <font-awesome-icon
                        v-if="canManage(user)"
                        icon="times"
                        class="ms-1 remove"
                        :title="$t('stackAccessRemove')"
                        @click="save(userIDs.filter((id) => id !== user.id))"
                    />
                </span>
            </div>

            <form v-if="candidateList.length > 0" class="input-group" @submit.prevent="save([ ...userIDs, selectedUserID ])">
                <select v-model="selectedUserID" class="form-select" required>
                    <option :value="null" disabled>{{ $t("stackAccessSelectUser") }}</option>
                    <option v-for="user in candidateList" :key="user.id" :value="user.id">
                        {{ user.username }} ({{ $t("role_" + user.role) }})
                    </option>
                </select>
                <button class="btn btn-primary" type="submit" :disabled="processing || selectedUserID === null">
                    {{ $t("stackAccessAdd") }}
                </button>
            </form>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        endpoint: {
            type: String,
            default: "",
        },
        stackName: {
            type: String,
            required: true,
        },
    },
    data() {
        return {
            userList: [],
            assignableUserList: [],
            selectedUserID: null,
            processing: false,
        };
    },
    computed: {
        userIDs() {
            return this.userList.map((user) => user.id);
        },
        candidateList() {
            return this.assignableUserList.filter((user) => !this.userIDs.includes(user.id));
        },
    },
    watch: {
        stackName() {
            this.load();
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        canManage(user) {
            return this.assignableUserList.some((assignable) => assignable.id === user.id);
        },

        load() {
            this.$root.getSocket().emit("getStackAccess", this.endpoint, this.stackName, (res) => {
                if (res.ok) {
                    this.userList = res.userList;
                    this.assignableUserList = res.assignableUserList;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        save(userIDs) {
            this.processing = true;
            this.$root.getSocket().emit("setStackAccess", this.endpoint, this.stackName, userIDs, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.userList = res.userList;
                    this.selectedUserID = null;
                }
            });
        },
    },
};
</script>

<style scoped lang="scss">
@import "../styles/vars.scss";

.user-badge {
    background-color: $primary;
    color: #fff;
    font-size: 0.9rem;
    font-weight: normal;

    .role {
        opacity: 0.75;
    }

    .remove {
        cursor: pointer;

        &:hover {
            opacity: 0.7;
        }
    }
}
</style>
