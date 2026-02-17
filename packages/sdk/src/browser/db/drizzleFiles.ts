// This file embeds the drizzle migration files as strings for browser runtime
// These files are copied from src/db/drizzle at build time

// Individual migration SQL files
export const migrationSql_0000_married_malice = `CREATE TABLE \`appState\` (
	\`key\` text,
	\`value\` text,
	\`created_at\` integer,
	\`updated_at\` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`appState_key_unique\` ON \`appState\` (\`key\`);--> statement-breakpoint
CREATE TABLE \`config\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`key\` text NOT NULL,
	\`text\` text,
	\`json\` text,
	\`blob\` blob
);
--> statement-breakpoint
CREATE TABLE \`metadata\` (
	\`local_id\` text,
	\`uid\` text,
	\`property_name\` text,
	\`property_value\` text,
	\`schema_uid\` text,
	\`model_type\` text,
	\`seed_local_id\` text,
	\`seed_uid\` text,
	\`version_local_id\` text,
	\`version_uid\` text,
	\`eas_data_type\` text,
	\`ref_value_type\` text,
	\`ref_schema_uid\` text,
	\`ref_seed_type\` text,
	\`ref_resolved_value\` text,
	\`ref_resolved_display_value\` text,
	\`local_storage_dir\` text,
	\`attestation_raw\` text,
	\`attestation_created_at\` integer,
	\`content_hash\` text,
	\`created_at\` integer,
	\`updated_at\` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`metadata_local_id_unique\` ON \`metadata\` (\`local_id\`);--> statement-breakpoint
CREATE TABLE \`models\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`name\` text NOT NULL,
	\`schema_file_id\` text
);
--> statement-breakpoint
CREATE TABLE \`properties\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`name\` text NOT NULL,
	\`data_type\` text NOT NULL,
	\`model_id\` integer NOT NULL,
	\`ref_model_id\` integer,
	\`ref_value_type\` text,
	\`schema_file_id\` text,
	FOREIGN KEY (\`model_id\`) REFERENCES \`models\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`ref_model_id\`) REFERENCES \`models\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`unique_name_model_id\` ON \`properties\` (\`name\`,\`model_id\`);--> statement-breakpoint
CREATE TABLE \`model_schemas\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`model_id\` integer,
	\`schema_id\` integer,
	FOREIGN KEY (\`model_id\`) REFERENCES \`models\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`schema_id\`) REFERENCES \`schemas\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`model_uids\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`uid\` text NOT NULL,
	\`model_id\` integer NOT NULL,
	FOREIGN KEY (\`model_id\`) REFERENCES \`models\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`model_uids_model_id_unique\` ON \`model_uids\` (\`model_id\`);--> statement-breakpoint
CREATE TABLE \`property_uids\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`uid\` text NOT NULL,
	\`property_id\` integer NOT NULL,
	FOREIGN KEY (\`property_id\`) REFERENCES \`models\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`property_uids_property_id_unique\` ON \`property_uids\` (\`property_id\`);--> statement-breakpoint
CREATE TABLE \`schemas\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`name\` text NOT NULL,
	\`version\` integer NOT NULL,
	\`schema_file_id\` text,
	\`created_at\` integer,
	\`updated_at\` integer
);
--> statement-breakpoint
CREATE TABLE \`seeds\` (
	\`local_id\` text,
	\`uid\` text,
	\`schema_uid\` text,
	\`type\` text,
	\`attestation_raw\` text,
	\`attestation_created_at\` integer,
	\`created_at\` integer,
	\`updated_at\` integer,
	\`_marked_for_deletion\` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`seeds_local_id_unique\` ON \`seeds\` (\`local_id\`);--> statement-breakpoint
CREATE TABLE \`versions\` (
	\`local_id\` text,
	\`uid\` text,
	\`seed_local_id\` text,
	\`seed_uid\` text,
	\`seed_type\` text,
	\`note\` text,
	\`created_at\` integer,
	\`updated_at\` integer,
	\`attestation_created_at\` integer,
	\`attestation_raw\` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`versions_local_id_unique\` ON \`versions\` (\`local_id\`);`

export const migrationSql_0001_sweet_bruce_banner = `ALTER TABLE \`schemas\` ADD \`schema_data\` text;--> statement-breakpoint
ALTER TABLE \`schemas\` ADD \`is_draft\` integer;`

export const migrationSql_0002_bitter_proudstar = `CREATE UNIQUE INDEX \`unique_schema_file_id\` ON \`models\` (\`schema_file_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`unique_property_schema_file_id\` ON \`properties\` (\`schema_file_id\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`unique_schema_schema_file_id\` ON \`schemas\` (\`schema_file_id\`);`

export const migrationSql_0003_cultured_senator_kelly = `ALTER TABLE \`models\` ADD \`is_edited\` integer;--> statement-breakpoint
ALTER TABLE \`properties\` ADD \`is_edited\` integer;--> statement-breakpoint
ALTER TABLE \`schemas\` ADD \`is_edited\` integer;`

export const migrationSql_0004_add_publisher_to_seeds = `ALTER TABLE \`seeds\` ADD \`publisher\` text;`

// Journal JSON file
export const journalJson = `{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    {
      "idx": 0,
      "version": "6",
      "when": 1765976502903,
      "tag": "0000_married_malice",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "6",
      "when": 1766010851770,
      "tag": "0001_sweet_bruce_banner",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "6",
      "when": 1767621120087,
      "tag": "0002_bitter_proudstar",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "6",
      "when": 1768415440282,
      "tag": "0003_cultured_senator_kelly",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "6",
      "when": 1768500000000,
      "tag": "0004_add_publisher_to_seeds",
      "breakpoints": true
    }
  ]
}`

// Snapshot JSON file - this is large, so we'll import it dynamically if needed
// For now, we'll read it from the actual file if ?raw works, otherwise we'll need to embed it
export const snapshotJson = `{
  "version": "6",
  "dialect": "sqlite",
  "id": "6450cc9b-cbee-45c0-92ff-794e832eb2ea",
  "prevId": "0e6a6a99-2eb1-4b1d-815b-3d45dcae04a1",
  "tables": {
    "appState": {
      "name": "appState",
      "columns": {
        "key": {
          "name": "key",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "value": {
          "name": "value",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "created_at": {
          "name": "created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "updated_at": {
          "name": "updated_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "appState_key_unique": {
          "name": "appState_key_unique",
          "columns": [
            "key"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "config": {
      "name": "config",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "key": {
          "name": "key",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "text": {
          "name": "text",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "json": {
          "name": "json",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "blob": {
          "name": "blob",
          "type": "blob",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "metadata": {
      "name": "metadata",
      "columns": {
        "local_id": {
          "name": "local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "uid": {
          "name": "uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "property_name": {
          "name": "property_name",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "property_value": {
          "name": "property_value",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "schema_uid": {
          "name": "schema_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "model_type": {
          "name": "model_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "seed_local_id": {
          "name": "seed_local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "seed_uid": {
          "name": "seed_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "version_local_id": {
          "name": "version_local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "version_uid": {
          "name": "version_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "eas_data_type": {
          "name": "eas_data_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_value_type": {
          "name": "ref_value_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_schema_uid": {
          "name": "ref_schema_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_seed_type": {
          "name": "ref_seed_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_resolved_value": {
          "name": "ref_resolved_value",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_resolved_display_value": {
          "name": "ref_resolved_display_value",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "local_storage_dir": {
          "name": "local_storage_dir",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_raw": {
          "name": "attestation_raw",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_created_at": {
          "name": "attestation_created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "content_hash": {
          "name": "content_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "created_at": {
          "name": "created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "updated_at": {
          "name": "updated_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "metadata_local_id_unique": {
          "name": "metadata_local_id_unique",
          "columns": [
            "local_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "models": {
      "name": "models",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "schema_file_id": {
          "name": "schema_file_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "is_edited": {
          "name": "is_edited",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "unique_schema_file_id": {
          "name": "unique_schema_file_id",
          "columns": [
            "schema_file_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "properties": {
      "name": "properties",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "data_type": {
          "name": "data_type",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "model_id": {
          "name": "model_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "ref_model_id": {
          "name": "ref_model_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "ref_value_type": {
          "name": "ref_value_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "schema_file_id": {
          "name": "schema_file_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "is_edited": {
          "name": "is_edited",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "unique_name_model_id": {
          "name": "unique_name_model_id",
          "columns": [
            "name",
            "model_id"
          ],
          "isUnique": true
        },
        "unique_property_schema_file_id": {
          "name": "unique_property_schema_file_id",
          "columns": [
            "schema_file_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {
        "properties_model_id_models_id_fk": {
          "name": "properties_model_id_models_id_fk",
          "tableFrom": "properties",
          "tableTo": "models",
          "columnsFrom": [
            "model_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        },
        "properties_ref_model_id_models_id_fk": {
          "name": "properties_ref_model_id_models_id_fk",
          "tableFrom": "properties",
          "tableTo": "models",
          "columnsFrom": [
            "ref_model_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "model_schemas": {
      "name": "model_schemas",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "model_id": {
          "name": "model_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "schema_id": {
          "name": "schema_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {},
      "foreignKeys": {
        "model_schemas_model_id_models_id_fk": {
          "name": "model_schemas_model_id_models_id_fk",
          "tableFrom": "model_schemas",
          "tableTo": "models",
          "columnsFrom": [
            "model_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        },
        "model_schemas_schema_id_schemas_id_fk": {
          "name": "model_schemas_schema_id_schemas_id_fk",
          "tableFrom": "model_schemas",
          "tableTo": "schemas",
          "columnsFrom": [
            "schema_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "model_uids": {
      "name": "model_uids",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "uid": {
          "name": "uid",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "model_id": {
          "name": "model_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        }
      },
      "indexes": {
        "model_uids_model_id_unique": {
          "name": "model_uids_model_id_unique",
          "columns": [
            "model_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {
        "model_uids_model_id_models_id_fk": {
          "name": "model_uids_model_id_models_id_fk",
          "tableFrom": "model_uids",
          "tableTo": "models",
          "columnsFrom": [
            "model_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "property_uids": {
      "name": "property_uids",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "uid": {
          "name": "uid",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "property_id": {
          "name": "property_id",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        }
      },
      "indexes": {
        "property_uids_property_id_unique": {
          "name": "property_uids_property_id_unique",
          "columns": [
            "property_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {
        "property_uids_property_id_models_id_fk": {
          "name": "property_uids_property_id_models_id_fk",
          "tableFrom": "property_uids",
          "tableTo": "models",
          "columnsFrom": [
            "property_id"
          ],
          "columnsTo": [
            "id"
          ],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "schemas": {
      "name": "schemas",
      "columns": {
        "id": {
          "name": "id",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "autoincrement": true
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "version": {
          "name": "version",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "autoincrement": false
        },
        "schema_file_id": {
          "name": "schema_file_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "schema_data": {
          "name": "schema_data",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "is_draft": {
          "name": "is_draft",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "is_edited": {
          "name": "is_edited",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "created_at": {
          "name": "created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "updated_at": {
          "name": "updated_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "unique_schema_schema_file_id": {
          "name": "unique_schema_schema_file_id",
          "columns": [
            "schema_file_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "seeds": {
      "name": "seeds",
      "columns": {
        "local_id": {
          "name": "local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "uid": {
          "name": "uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "schema_uid": {
          "name": "schema_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "type": {
          "name": "type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "publisher": {
          "name": "publisher",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_raw": {
          "name": "attestation_raw",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_created_at": {
          "name": "attestation_created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "created_at": {
          "name": "created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "updated_at": {
          "name": "updated_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "_marked_for_deletion": {
          "name": "_marked_for_deletion",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "seeds_local_id_unique": {
          "name": "seeds_local_id_unique",
          "columns": [
            "local_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    },
    "versions": {
      "name": "versions",
      "columns": {
        "local_id": {
          "name": "local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "uid": {
          "name": "uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "seed_local_id": {
          "name": "seed_local_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "seed_uid": {
          "name": "seed_uid",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "seed_type": {
          "name": "seed_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "note": {
          "name": "note",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "created_at": {
          "name": "created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "updated_at": {
          "name": "updated_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_created_at": {
          "name": "attestation_created_at",
          "type": "integer",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        },
        "attestation_raw": {
          "name": "attestation_raw",
          "type": "text",
          "primaryKey": false,
          "notNull": false,
          "autoincrement": false
        }
      },
      "indexes": {
        "versions_local_id_unique": {
          "name": "versions_local_id_unique",
          "columns": [
            "local_id"
          ],
          "isUnique": true
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "checkConstraints": {}
    }
  },
  "views": {},
  "enums": {},
  "_meta": {
    "schemas": {},
    "tables": {},
    "columns": {}
  },
  "internal": {
    "indexes": {}
  }
}`
