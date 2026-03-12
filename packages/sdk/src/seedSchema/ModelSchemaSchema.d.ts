import { InferSelectModel } from 'drizzle-orm';
export declare const modelSchemas: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "model_schemas";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "model_schemas";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        modelId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "model_id";
            tableName: "model_schemas";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        schemaId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "schema_id";
            tableName: "model_schemas";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "sqlite";
}>;
export type ModelSchemaType = InferSelectModel<typeof modelSchemas>;
//# sourceMappingURL=ModelSchemaSchema.d.ts.map