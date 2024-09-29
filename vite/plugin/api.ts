// vite-plugin-api.ts
import { Plugin } from 'vite'
import express, { Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

const getAllFiles = async (
  dirPath: string,
  arrayOfFiles = [],
  relativePath = '',
) => {
  const files = await fs.promises.readdir(dirPath, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(dirPath, file.name)
    const relPath = path.join(relativePath, file.name)

    if (file.isDirectory()) {
      await getAllFiles(filePath, arrayOfFiles, relPath)
    } else {
      arrayOfFiles.push(relPath)
    }
  }

  return arrayOfFiles
}

export const apiRoutes = (): Plugin => {
  return {
    name: 'vite-plugin-api',
    configureServer(server) {
      const app = express()

      app.use(express.json())

      app.use((req, res, next) => {
        const filePath = path.join(__dirname, '..', req.path)

        fs.stat(filePath, (err, stat) => {
          if (err) {
            return next()
          }

          if (stat.isFile()) {
            return res.sendFile(filePath)
          } else {
            next()
          }
        })
      })

      app.get('/api/seed/migrations', async (req: Request, res: Response) => {
        const dbDir = path.join(__dirname, '..', 'app-files')

        const files = await getAllFiles(dbDir)
        
        res.json(files)
      })

      server.middlewares.use(app)
    },
  }
}
