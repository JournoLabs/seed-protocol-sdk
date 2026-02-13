import { ActorRefFrom, assign } from "xstate";
import { publishMachine } from "../../publish";

export const stopAll = assign(({context, event}) => {
  Object.values(context.publishProcesses).forEach((publishProcess) => {
    (publishProcess as ActorRefFrom<typeof publishMachine>).stop();
  });
  return { publishProcesses: {} };
})