import { ModelValues } from '@/types'

const FileView = ({ file }: { file: File<ModelValues<any>> }) => {
  // const fileProps = useFileProps(item)

  return (
    <div>
      <hr />
      <ul>
        {/*{itemProps && (*/}
        {/*  <>*/}
        {/*    <li>item.localId: {itemProps.localId}</li>*/}
        {/*    <li>item.schemaUid: {itemProps.schemaUid}</li>*/}
        {/*    <li>item.versionUid: {itemProps.versionUid}</li>*/}
        {/*    <li>item.title: {itemProps.title}</li>*/}
        {/*    <li>item.summary: {itemProps.summary}</li>*/}
        {/*    <li>item.featureImage: {itemProps.feature_image_id}</li>*/}
        {/*  </>*/}
        {/*)}*/}
        {/*<li>*/}
        {/*  item.localId: {item.localId} {itemProps.localId}*/}
        {/*</li>*/}
        {/*<li>item.seedUid: {item.seedUid}</li>*/}
        {/*<li>item.schemaUid: {item.schemaUid}</li>*/}
        {/*{!!item.currentVersion && (*/}
        {/*  <>*/}
        {/*    <li>item.currentVersion.id: {item.currentVersion.id}</li>*/}
        {/*    <li>item.currentVersion.uid: {item.currentVersion.uid}</li>*/}
        {/*  </>*/}
        {/*)}*/}
        {/*{!!currentTitle && <li>item.title: {currentTitle}</li>}*/}
      </ul>
    </div>
  )
}

export default FileView
