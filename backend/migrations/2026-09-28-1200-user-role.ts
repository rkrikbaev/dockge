import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    // Existing users (created by the setup page) keep full access
    return knex.schema.alterTable("user", (table) => {
        table.string("role", 20).notNullable().defaultTo("admin");
    });
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.alterTable("user", (table) => {
        table.dropColumn("role");
    });
}
