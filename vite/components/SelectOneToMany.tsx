import { Combobox } from '@headlessui/react'

const SelectOneToMany = () => {
  return (
    <Combobox>
      <Combobox.Input />
      <Combobox.Options>
        <Combobox.Option />
      </Combobox.Options>
    </Combobox>
  )
}

export default SelectOneToMany
