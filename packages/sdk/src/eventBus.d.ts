type EventKey = string | symbol;
type Listener = (...args: any[]) => void;
interface SeedEventEmitterLike {
    on(event: EventKey, listener: Listener): this;
    addListener(event: EventKey, listener: Listener): this;
    once(event: EventKey, listener: Listener): this;
    off(event: EventKey, listener: Listener): this;
    removeListener(event: EventKey, listener: Listener): this;
    removeAllListeners(event?: EventKey): this;
    emit(event: EventKey, ...args: any[]): boolean;
}
declare const eventEmitter: SeedEventEmitterLike;
export { eventEmitter };
//# sourceMappingURL=eventBus.d.ts.map