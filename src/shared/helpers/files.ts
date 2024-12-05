export const listFilesInOPFSRoot = async () => {
  // Get the root directory handle
  const rootDirHandle = await navigator.storage.getDirectory()

  // Initialize an array to hold the file names
  let fileNames = []

  // Create an async iterator to loop through directory entries
  for await (const entry of rootDirHandle.values()) {
    if (entry.kind === 'file') {
      fileNames.push(entry.name)
    }
  }

  return fileNames
}
