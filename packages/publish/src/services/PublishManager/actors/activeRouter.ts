import { FromCallbackInput, PublishManagerMachineContext } from "~/types/machines";
import { fromCallback, EventObject } from "xstate";
import type { Item } from "@seedprotocol/sdk";
import type { Account } from "thirdweb/wallets";

type CreatePublishEvent = { type: 'CREATE_PUBLISH'; item: Item<unknown>; address: string; account?: Account };

export const activeRouter = fromCallback<
EventObject, FromCallbackInput<PublishManagerMachineContext>
>(({sendBack, receive, input: {context, event}}) => {

  receive((event) => {
    if (event.type === 'CREATE_PUBLISH') {
      const e = event as CreatePublishEvent
      sendBack({ type: 'CREATE_PUBLISH', item: e.item, address: e.address, account: e.account })
    }
  })


})