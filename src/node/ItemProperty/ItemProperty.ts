import { IItemProperty } from '@/interfaces'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'
import { CreatePropertyInstanceProps, ModelSchema, ModelValues, } from '@/types'

export class ItemProperty<PropertyType> extends BaseItemProperty<PropertyType> implements IItemProperty<PropertyType> {
  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    super(initialValues)
  }
}