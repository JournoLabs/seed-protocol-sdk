import {
  ModelSchema,
  ModelValues,
  NewItemProps,
} from '@/types'
import { BaseItem } from '@/Item/BaseItem'
import { IItem } from '@/interfaces'

export class Item<T extends ModelValues<ModelSchema>> extends BaseItem<T> implements IItem<T> {

  constructor(initialValues: NewItemProps<T>,) {
    super(initialValues,)
  }

}
