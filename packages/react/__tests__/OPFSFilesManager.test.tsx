import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import React from 'react'
import { OPFSFilesManager } from '../src/OPFSFilesManager'

const TX = 'Xq7m3kR2vT9pLw4nB8cZ1yH6dF0sJ5gAeUoKiQrMtx'
let root = ''

async function writeOPFS(path: string, data: BlobPart) {
  const parts = path.split('/')
  const name = parts.pop()!
  let dir = await navigator.storage.getDirectory()
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

async function existsOPFS(path: string): Promise<boolean> {
  const parts = path.split('/')
  const name = parts.pop()!
  try {
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

async function pngBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 6
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#2c6b59'
  ctx.fillRect(0, 0, 8, 6)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}

beforeEach(async () => {
  root = `opfs-fm-test-${Math.random().toString(36).slice(2, 8)}`
  const png = await pngBlob()
  await writeOPFS(`${root}/db/seed.db`, 'SQLite format 3\0' + 'x'.repeat(100))
  await writeOPFS(`${root}/files/images/ridge.png`, png)
  await writeOPFS(`${root}/files/images/480/ridge.webp`, png)
  await writeOPFS(`${root}/files/images/1024/ridge.webp`, png)
  await writeOPFS(`${root}/files/images/${TX}`, png)
  await writeOPFS(`${root}/files/json/abc.json`, '{"title":"Field notes"}')
})

afterEach(async () => {
  cleanup()
  const opfs = await navigator.storage.getDirectory()
  await opfs.removeEntry(root, { recursive: true }).catch(() => {})
})

const openFolder = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}\\b`) }))

describe('OPFSFilesManager', () => {
  it('shows folders and navigates with breadcrumbs', async () => {
    render(<OPFSFilesManager rootPath={root} />)
    await openFolder('files')
    await openFolder('images')
    const crumbs = within(screen.getByRole('navigation', { name: 'Folder' }))
    expect(crumbs.getByRole('button', { name: 'images' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(crumbs.getByRole('button', { name: root }))
    expect(await screen.findByRole('button', { name: /^db\b/ })).toBeTruthy()
  })

  it('groups resized copies and shows thumbnails, including for extensionless images', async () => {
    const { container } = render(<OPFSFilesManager rootPath={root} />)
    await openFolder('files')
    await openFolder('images')

    const tiles = within(await screen.findByRole('listbox', { name: 'Files' })).getAllByRole('option')
    expect(tiles.map((t) => t.getAttribute('aria-label')).sort()).toEqual(['ridge.png', TX].sort())
    expect(within(tiles.find((t) => t.getAttribute('aria-label') === 'ridge.png')!).getByText('2 sizes')).toBeTruthy()
    // Size folders disappear once their files are grouped.
    expect(screen.queryByRole('button', { name: /^480\b/ })).toBeNull()

    await waitFor(() => expect(container.querySelectorAll('.seed-fm-thumb img')).toHaveLength(2))
  })

  it('lists detected types in list view', async () => {
    render(<OPFSFilesManager rootPath={root} defaultView="list" />)
    await openFolder('files')
    await openFolder('images')
    const row = (await screen.findByRole('button', { name: TX })).closest('tr')!
    expect(row.textContent).toContain('image/png')
    expect(row.textContent).toContain('detected')
  })

  it('opens a details panel with the path and resized copies', async () => {
    render(<OPFSFilesManager rootPath={root} />)
    await openFolder('files')
    await openFolder('images')
    fireEvent.click(await screen.findByRole('option', { name: 'ridge.png' }))
    const panel = await screen.findByRole('dialog', { name: 'ridge.png' })
    expect(panel.textContent).toContain(`${root}/files/images/ridge.png`)
    expect(panel.textContent).toContain('480w')
    expect(panel.textContent).toContain('1024w')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog', { name: 'ridge.png' })).toBeNull()
  })

  it('deletes selected files and their resized copies after confirmation', async () => {
    const onAfterDelete = vi.fn()
    render(<OPFSFilesManager rootPath={root} onAfterDelete={onAfterDelete} />)
    await openFolder('files')
    await openFolder('images')

    fireEvent.click(await screen.findByRole('button', { name: 'Select ridge.png' }))
    const bar = screen.getByRole('toolbar', { name: 'Selected files' })
    expect(bar.textContent).toContain('1 selected')
    fireEvent.click(within(bar).getByRole('button', { name: /Delete/ }))

    const confirm = await screen.findByRole('button', { name: 'Delete 3 files' })
    fireEvent.click(confirm)

    await waitFor(() => expect(onAfterDelete).toHaveBeenCalledTimes(1))
    expect([...onAfterDelete.mock.calls[0][0]].sort()).toEqual(
      [
        `${root}/files/images/ridge.png`,
        `${root}/files/images/480/ridge.webp`,
        `${root}/files/images/1024/ridge.webp`,
      ].sort(),
    )
    expect(await existsOPFS(`${root}/files/images/ridge.png`)).toBe(false)
    expect(await existsOPFS(`${root}/files/images/${TX}`)).toBe(true)
    expect(await screen.findByText('Deleted 3 files')).toBeTruthy()
  })

  it('warns before deleting the Seed database and respects onBeforeDelete', async () => {
    const onBeforeDelete = vi.fn(() => false)
    render(<OPFSFilesManager rootPath={root} onBeforeDelete={onBeforeDelete} defaultView="list" />)
    await openFolder('db')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete seed.db' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Seed database/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 file' }))
    await waitFor(() => expect(onBeforeDelete).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/kept by onBeforeDelete/)).toBeTruthy()
    expect(await existsOPFS(`${root}/db/seed.db`)).toBe(true)
  })

  it('uses confirmDelete instead of the built-in dialog', async () => {
    const confirmDelete = vi.fn(async () => false)
    render(<OPFSFilesManager rootPath={root} confirmDelete={confirmDelete} defaultView="list" />)
    await openFolder('files')
    await openFolder('json')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete abc.json' }))
    await waitFor(() => expect(confirmDelete).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Delete 1 file' })).toBeNull()
    expect(await existsOPFS(`${root}/files/json/abc.json`)).toBe(true)
  })

  it('explains a missing rootPath', async () => {
    render(<OPFSFilesManager rootPath={`${root}-missing`} />)
    expect((await screen.findByRole('alert')).textContent).toContain(`Can’t open ${root}-missing`)
  })

  it('shows an empty state', async () => {
    const opfs = await navigator.storage.getDirectory()
    await opfs.getDirectoryHandle(`${root}-empty`, { create: true })
    render(<OPFSFilesManager rootPath={`${root}-empty`} />)
    expect(await screen.findByText(`No files in ${root}-empty yet`)).toBeTruthy()
    await opfs.removeEntry(`${root}-empty`)
  })

  it('applies theme and classNames', async () => {
    const { container, rerender } = render(<OPFSFilesManager rootPath={root} classNames={{ root: 'host-root' }} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.dataset.seedTheme).toBe('system')
    expect(el.classList.contains('host-root')).toBe(true)
    expect(document.getElementById('seed-opfs-files-manager-styles')).not.toBeNull()
    rerender(<OPFSFilesManager rootPath={root} theme="none" />)
    expect((container.firstElementChild as HTMLElement).dataset.seedTheme).toBeUndefined()
  })
})
