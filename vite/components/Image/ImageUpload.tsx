import { FC, useState } from 'react'
import { ItemProperty } from '../../src/browser'

type ImageUploadProps = {
  itemProperty: ItemProperty<any>
}

export const ImageUpload: FC<ImageUploadProps> = ({ itemProperty }) => {
  const [isUploading, setIsUploading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const handleImageUpload = (e) => {
    setIsUploading(true)
    const file = e.target.files && e.target.files[0]
    if (!file) {
      return
    }

    console.log('[ImageUpload] file', file)

    itemProperty.value = file
  }

  return (
    <>
      {isUploading && <div>Uploading...</div>}
      {isSaving && <div>Saving...</div>}
      {!isUploading && !isSaving && (
        <input
          type='file'
          accept={'image/*'}
          onChange={handleImageUpload}
        />
      )}
    </>
  )
}

export default ImageUpload
