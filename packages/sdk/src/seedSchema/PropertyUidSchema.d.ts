export declare const propertyUids: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "property_uids";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "property_uids";
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
        uid: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "uid";
            tableName: "property_uids";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            length: number | undefined;
        }>;
        propertyId: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "property_id";
            tableName: "property_uids";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
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
export declare const propertyUidRelations: import("drizzle-orm").Relations<"property_uids", {
    property: import("drizzle-orm").One<"properties", false>;
}>;
//# sourceMappingURL=PropertyUidSchema.d.ts.map