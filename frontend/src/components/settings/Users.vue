<template>
    <div class="my-4">
        <p class="text-secondary">{{ $t("usersDescription") }}</p>

        <!-- User List -->
        <div class="table-responsive mb-4">
            <table class="table align-middle user-table">
                <thead>
                    <tr>
                        <th>{{ $t("Username") }}</th>
                        <th>{{ $t("Role") }}</th>
                        <th>{{ $t("Active") }}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="user in userList" :key="user.id">
                        <td>
                            {{ user.username }}
                            <span v-if="isSelf(user)" class="badge bg-secondary ms-1">{{ $t("You") }}</span>
                        </td>
                        <td>
                            <select
                                class="form-select form-select-sm role-select"
                                :value="user.role"
                                :disabled="isSelf(user) || processing"
                                @change="updateUser(user, { role: $event.target.value })"
                            >
                                <option v-for="role in roleList" :key="role" :value="role">{{ $t("role_" + role) }}</option>
                            </select>
                        </td>
                        <td>
                            <div class="form-check form-switch">
                                <input
                                    class="form-check-input"
                                    type="checkbox"
                                    :checked="user.active"
                                    :disabled="isSelf(user) || processing"
                                    @change="updateUser(user, { active: $event.target.checked })"
                                />
                            </div>
                        </td>
                        <td class="text-end text-nowrap">
                            <button v-if="!isSelf(user)" class="btn btn-sm btn-normal me-2" :title="$t('Reset Password')" :disabled="processing" @click="showResetPassword(user)">
                                <font-awesome-icon icon="key" />
                            </button>
                            <button v-if="!isSelf(user)" class="btn btn-sm btn-danger" :title="$t('Delete')" :disabled="processing" @click="showDeleteUser(user)">
                                <font-awesome-icon icon="trash" />
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Role Description -->
        <ul class="small text-secondary mb-4">
            <li v-for="role in roleList" :key="role">
                <strong>{{ $t("role_" + role) }}</strong>: {{ $t("roleDescription_" + role) }}
            </li>
        </ul>

        <!-- Add User -->
        <h5 class="my-4 settings-subheading">{{ $t("Add User") }}</h5>
        <form class="mb-3" autocomplete="off" @submit.prevent="addUser">
            <div class="mb-3">
                <label for="new-user-username" class="form-label">{{ $t("Username") }}</label>
                <input id="new-user-username" v-model="newUser.username" type="text" class="form-control" autocomplete="off" required />
            </div>

            <div class="mb-3">
                <label for="new-user-password" class="form-label">{{ $t("Password") }}</label>
                <input id="new-user-password" v-model="newUser.password" type="password" class="form-control" autocomplete="new-password" required />
            </div>

            <div class="mb-3">
                <label for="new-user-role" class="form-label">{{ $t("Role") }}</label>
                <select id="new-user-role" v-model="newUser.role" class="form-select">
                    <option v-for="role in roleList" :key="role" :value="role">{{ $t("role_" + role) }}</option>
                </select>
            </div>

            <button class="btn btn-primary" type="submit" :disabled="processing">
                {{ $t("Add User") }}
            </button>
        </form>

        <!-- Reset Password Dialog -->
        <Confirm ref="confirmResetPassword" btn-style="btn-primary" :yes-text="$t('Reset Password')" :no-text="$t('Cancel')" @yes="resetPassword">
            <p>{{ $t("resetPasswordMsg", [ selectedUser?.username ]) }}</p>
            <label for="reset-password" class="form-label">{{ $t("New Password") }}</label>
            <input id="reset-password" v-model="resetPasswordValue" type="password" class="form-control" autocomplete="new-password" />
        </Confirm>

        <!-- Delete User Dialog -->
        <Confirm ref="confirmDeleteUser" btn-style="btn-danger" :yes-text="$t('Delete')" :no-text="$t('Cancel')" @yes="deleteUser">
            {{ $t("deleteUserMsg", [ selectedUser?.username ]) }}
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import { ROLE_LIST, ROLE_VIEWER } from "../../../../common/roles";

export default {
    components: {
        Confirm,
    },

    data() {
        return {
            userList: [],
            roleList: ROLE_LIST,
            processing: false,
            newUser: {
                username: "",
                password: "",
                role: ROLE_VIEWER,
            },
            selectedUser: null,
            resetPasswordValue: "",
        };
    },

    mounted() {
        this.loadUserList();
    },

    methods: {
        loadUserList() {
            this.$root.getSocket().emit("getUserList", (res) => {
                if (res.ok) {
                    this.userList = res.userList;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        isSelf(user) {
            return user.username === this.$root.username;
        },

        addUser() {
            this.processing = true;
            this.$root.getSocket().emit("addUser", this.newUser, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                if (res.ok) {
                    this.newUser = {
                        username: "",
                        password: "",
                        role: ROLE_VIEWER,
                    };
                    this.loadUserList();
                }
            });
        },

        updateUser(user, changes) {
            this.processing = true;
            const data = {
                id: user.id,
                ...changes,
            };
            this.$root.getSocket().emit("updateUser", data, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                // Reload in both cases, so the controls show the actual state
                this.loadUserList();
            });
        },

        showResetPassword(user) {
            this.selectedUser = user;
            this.resetPasswordValue = "";
            this.$refs.confirmResetPassword.show();
        },

        resetPassword() {
            this.updateUser(this.selectedUser, { password: this.resetPasswordValue });
            this.resetPasswordValue = "";
        },

        showDeleteUser(user) {
            this.selectedUser = user;
            this.$refs.confirmDeleteUser.show();
        },

        deleteUser() {
            this.processing = true;
            this.$root.getSocket().emit("deleteUser", this.selectedUser.id, (res) => {
                this.processing = false;
                this.$root.toastRes(res);
                this.loadUserList();
            });
        },
    },
};
</script>

<style lang="scss" scoped>
// Follow the page background / text color in both light and dark theme
.user-table {
    --bs-table-bg: transparent;
    --bs-table-color: inherit;
    --bs-table-border-color: rgba(128, 128, 128, 0.25);
}

.role-select {
    min-width: 120px;
}
</style>
