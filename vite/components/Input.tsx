import { FC, HTMLAttributes, useEffect, useState } from 'react'

type Props = HTMLAttributes<HTMLInputElement> & {
  value: string | undefined
  onChange?: (value: string | undefined) => void
}

export const Input: FC<Props> = ({ value, onChange }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState()

  const handleEditStart = () => {
    setIsEditing(true)
  }

  const handleBlur = () => {
    setIsEditing(false)
  }

  const handelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    onChange(e.target.value)
  }

  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value)
    }
  }, [value])

  return (
    <div className={'w-full h-10 p-2'}>
      {/*{!isEditing && (*/}
      {/*  <div*/}
      {/*    onClick={handleEditStart}*/}
      {/*    className={'w-full h-10 p-2'}*/}
      {/*  >*/}
      {/*    {value || 'undefined'}*/}
      {/*  </div>*/}
      {/*)}*/}
      {/*{isEditing && (*/}
      <input
        className={'outline-none bg-transparent'}
        type='text'
        placeholder='undefined'
        autoFocus={true}
        value={inputValue}
        onBlur={handleBlur}
        onChange={handelChange}
      />
      {/*)}*/}
    </div>
  )
}
