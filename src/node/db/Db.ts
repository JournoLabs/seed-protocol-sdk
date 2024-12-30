import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces";

export class Db extends BaseDb implements IDb {
  constructor() {
    super()
  }
}
