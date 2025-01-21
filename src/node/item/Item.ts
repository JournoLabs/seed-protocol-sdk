import { IItem } from '@/interfaces';
import { BaseItem } from '@/Item/BaseItem';
import { ModelSchema, ModelValues, NewItemProps } from '@/types';

export class Item<T extends ModelValues<ModelSchema>> extends BaseItem<T> implements IItem<T> {
  constructor(initialValues: NewItemProps<T>) {
    super(initialValues);
  }

}

BaseItem.setPlatformClass(Item)