import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { Request, Response, NextFunction, Router, RequestHandler } from 'express'
import { createServer as createViteServer } from 'vite'
import { ClientManager } from '../src/client/ClientManager'
import debug from 'debug'
import type { ParamsDictionary } from 'express-serve-static-core'
import type { ParsedQs } from 'qs'

const logger = debug('seedSdk:rpcServer')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface ModelDefinition {
  name: string
  type: string
  properties: Record<string, unknown>
}

interface ErrorResponse {
  error: string
}

interface SuccessResponse {
  success: true
}

interface AddressesResponse {
  addresses: string[]
}

interface InitializedResponse {
  isInitialized: boolean
}

interface HealthResponse {
  status: 'ok'
}

type ApiResponse = ErrorResponse | SuccessResponse | AddressesResponse | InitializedResponse | HealthResponse

type TypedRequestBody<T> = Request<ParamsDictionary, any, T, ParsedQs>
type TypedResponse<T> = Response<T>
type AsyncHandler<T = any> = (req: Request<ParamsDictionary, ApiResponse, T, ParsedQs>, res: Response<ApiResponse>) => Promise<void>
type SyncHandler = (req: Request, res: Response<ApiResponse>) => void

async function createServer() {
  const app = express()
  const router = Router()
  
  app.use(express.json())

  // Create Vite server in middleware mode
  const vite = await createViteServer({
    configFile: path.resolve(__dirname, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom'
  })

  // Use vite's connect instance as middleware
  app.use(vite.middlewares)

  // RPC Endpoints

  // Initialize the client
  const initHandler: AsyncHandler = async (req, res) => {
    try {
      const options = req.body
      await ClientManager.init(options)
      res.json({ success: true })
    } catch (error: unknown) {
      logger('Error in /rpc/init:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.post('/init', initHandler)

  // Set addresses
  const setAddressesHandler: AsyncHandler<{ addresses: string[] }> = async (req, res) => {
    try {
      const { addresses } = req.body
      if (!Array.isArray(addresses)) {
        res.status(400).json({ error: 'addresses must be an array' })
        return
      }
      await ClientManager.setAddresses(addresses)
      res.json({ success: true })
    } catch (error: unknown) {
      logger('Error in /rpc/setAddresses:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.post('/setAddresses', setAddressesHandler)

  // Get addresses
  const getAddressesHandler: AsyncHandler = async (_req, res) => {
    try {
      const addresses = await ClientManager.getAddresses()
      res.json({ addresses })
    } catch (error: unknown) {
      logger('Error in /rpc/getAddresses:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.get('/getAddresses', getAddressesHandler)

  // Add model
  const addModelHandler: AsyncHandler<ModelDefinition> = async (req, res) => {
    try {
      const modelDef = req.body
      if (!modelDef.name || !modelDef.type || !modelDef.properties) {
        res.status(400).json({ error: 'Invalid model definition' })
        return
      }
      await ClientManager.addModel(modelDef)
      res.json({ success: true })
    } catch (error: unknown) {
      logger('Error in /rpc/addModel:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.post('/addModel', addModelHandler)

  // Check initialization status
  const isInitializedHandler: SyncHandler = (_req, res) => {
    try {
      const isInitialized = ClientManager.isInitialized()
      res.json({ isInitialized })
    } catch (error: unknown) {
      logger('Error in /rpc/isInitialized:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.get('/isInitialized', isInitializedHandler)

  // Stop the client
  const stopHandler: SyncHandler = (_req, res) => {
    try {
      ClientManager.stop()
      res.json({ success: true })
    } catch (error: unknown) {
      logger('Error in /rpc/stop:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.post('/stop', stopHandler)

  // Unload the client
  const unloadHandler: SyncHandler = (_req, res) => {
    try {
      ClientManager.unload()
      res.json({ success: true })
    } catch (error: unknown) {
      logger('Error in /rpc/unload:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  router.post('/unload', unloadHandler)

  // Mount all RPC routes under /rpc
  app.use('/rpc', router)

  // Health check endpoint
  const healthHandler: SyncHandler = (_req, res) => {
    res.json({ status: 'ok' })
  }
  app.get('/health', healthHandler)

  // Error handler
  app.use((err: Error, _req: Request, res: TypedResponse<ApiResponse>, _next: NextFunction) => {
    logger('Unhandled error:', err)
    vite.ssrFixStacktrace(err)
    res.status(500).json({ error: 'Internal server error' })
  })

  const port = process.env.PORT || 5173
  app.listen(port, () => {
    logger(`RPC server running at http://localhost:${port}`)
  })
}

createServer().catch((err) => {
  logger('Failed to start server:', err)
  process.exit(1)
}) 