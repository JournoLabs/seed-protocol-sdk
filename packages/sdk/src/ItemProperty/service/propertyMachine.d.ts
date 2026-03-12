export declare const propertyMachine: import("xstate").StateMachine<PropertyMachineContext, import("xstate").AnyEventObject, {
    [x: string]: import("xstate").ActorRefFromLogic<any> | undefined;
}, {
    src: "waitForDb";
    logic: any;
    id: string | undefined;
} | {
    src: "loadOrCreateProperty";
    logic: any;
    id: string | undefined;
} | {
    src: "hydrateFromDb";
    logic: any;
    id: string | undefined;
} | {
    src: "initialize";
    logic: any;
    id: string | undefined;
} | {
    src: "resolveRelatedValue";
    logic: any;
    id: string | undefined;
} | {
    src: "resolveRemoteStorage";
    logic: any;
    id: string | undefined;
} | {
    src: "analyzeInput";
    logic: any;
    id: string | undefined;
} | {
    src: "saveImage";
    logic: any;
    id: string | undefined;
} | {
    src: "saveFile";
    logic: any;
    id: string | undefined;
} | {
    src: "saveHtml";
    logic: any;
    id: string | undefined;
} | {
    src: "saveRelation";
    logic: any;
    id: string | undefined;
} | {
    src: "saveItemStorage";
    logic: any;
    id: string | undefined;
}, never, never, never, "error" | "loading" | "idle" | "initializing" | "waitingForDb" | "hydratingFromDb" | "resolvingRelatedValue" | "resolvingRemoteStorage" | {
    saving: "analyzingInput" | "doneSaving" | "savingImage" | "savingFile" | "savingHtml" | "savingRelation" | "savingItemStorage";
}, string, PropertyMachineContext, import("xstate").NonReducibleUnknown, import("xstate").EventObject, import("xstate").MetaObject, {
    id: "itemProperty";
    states: {
        readonly idle: {};
        readonly waitingForDb: {};
        readonly loading: {};
        readonly error: {};
        readonly hydratingFromDb: {};
        readonly initializing: {};
        readonly resolvingRelatedValue: {};
        readonly resolvingRemoteStorage: {};
        readonly saving: {
            states: {
                readonly analyzingInput: {};
                readonly savingImage: {};
                readonly savingFile: {};
                readonly savingHtml: {};
                readonly savingRelation: {};
                readonly savingItemStorage: {};
                readonly doneSaving: {};
            };
        };
    };
}>;
//# sourceMappingURL=propertyMachine.d.ts.map