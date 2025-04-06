import { CreatePropertyInstanceProps, PropertyType } from '@/types'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'


class ItemProperty extends BaseItemProperty<PropertyType> implements IItemProperty<PropertyType> {


  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    super(initialValues)
  }

}

export { ItemProperty }
