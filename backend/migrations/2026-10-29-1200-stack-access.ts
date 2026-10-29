import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    // Stacks a non-admin user can see (endpoint "" = this instance)
    await knex.schema.createTable("stack_access", (table) => {
        table.increments("id");
        table.integer("user_id").unsigned().notNullable();
        table.string("endpoint", 255).notNullable().defaultTo("");
        table.string("stack_name", 255).notNullable();
        table.unique([ "user_id", "endpoint", "stack_name" ]);
    });

    // Stack templates, prepared by an admin and launched by operators
    await knex.schema.createTable("stack_template", (table) => {
        table.increments("id");
        table.string("name", 40).notNullable().unique();
        table.text("description").notNullable().defaultTo("");
        table.text("compose_yaml").notNullable();
        table.text("compose_env").notNullable().defaultTo("");
        table.datetime("created_date").notNullable().defaultTo(knex.fn.now());
    });

    // Operators who can launch a template
    await knex.schema.createTable("template_access", (table) => {
        table.increments("id");
        table.integer("template_id").unsigned().notNullable();
        table.integer("user_id").unsigned().notNullable();
        table.unique([ "template_id", "user_id" ]);
    });

    // Stacks launched from a template (this instance only)
    await knex.schema.createTable("sandbox", (table) => {
        table.increments("id");
        table.string("stack_name", 255).notNullable().unique();
        table.integer("template_id").unsigned();
        table.integer("created_by").unsigned().notNullable();
        table.datetime("created_date").notNullable().defaultTo(knex.fn.now());
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable("sandbox");
    await knex.schema.dropTable("template_access");
    await knex.schema.dropTable("stack_template");
    await knex.schema.dropTable("stack_access");
}
