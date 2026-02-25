import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

export const testModel = {
  name: 'TestModel',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    isActive: { type: 'boolean' }
  }
}

export const testModel_singleLine = {
  name: 'TestModelSingleLine',
  properties: {
    title: { type: 'string' }
  }
}

type RunCommandWithOutputArgs = {
  command: string,
  args: string[],
  options: {}
}

type RunCommandWithOutput = (args: RunCommandWithOutputArgs) => Promise<string>

export const runCommandWithOutput: RunCommandWithOutput = async ({command, args, options}) => {
  const output = execSync(`${command} ${args.join(' ')}`, {
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      IS_SEED_DEV: 'true',
    },
    ...options,
  }).toString()

  return output
}

// NOTE: This function is obsolete - it references the old decorator-based seed.config.ts approach
// Models are now defined in schema JSON files, not in seed.config.ts
// All tests using this function are commented out
export const runAddModel = async () => {
  const projectRoot = path.resolve(process.cwd(),)
  const addModelPath = path.resolve(projectRoot, 'scripts', 'addModel.ts');
  const nodeProjectDir = path.resolve(projectRoot, '__tests__', '__mocks__', 'node', 'project',)
  const schemaDirPath = path.resolve(nodeProjectDir);
  const dotSeedDir = path.resolve(nodeProjectDir, '.seed');
  // OBSOLETE: seed.config.ts is no longer used - models are defined in schema files
  const sourceSchemaFilePath = path.resolve(schemaDirPath, 'seed.config.ts');
  const outputFilePath = path.resolve(dotSeedDir, 'schemaTestOutput.ts');

  // Ensure the .seed directory exists
  if (!fs.existsSync(dotSeedDir)) {
    fs.mkdirSync(dotSeedDir, { recursive: true })
  }

  const output = await runCommandWithOutput({
    command: 'npx',
    args: ['tsx', addModelPath, sourceSchemaFilePath, outputFilePath, JSON.stringify(testModel)],
    options: {}
  })

  return output
}

export const runRpcServer = async () => {
  try {
    let rpcServerPath = path.resolve(process.cwd(), 'scripts', 'rpcServer.ts');

    if (rpcServerPath.includes('__tests__')) {
      rpcServerPath = path.join(process.cwd(), '..', '..', '..', '..', 'scripts', 'rpcServer.ts');
    }

    const command = `npx tsx ${rpcServerPath}`

    const output = execSync(command, {
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        IS_SEED_DEV: 'true',
      },
    }).toString()

    return output
  } catch (error: any) {
    console.error('Error running rpc server:', error.message)
    throw error
  }
}

export const runInit = async ({
  projectType,
  args,
}: {
  projectType: string
  args: string[]
}): Promise<string> => {
  try {
    // Get the path to the CLI bin file
    let binPath = path.join(process.cwd(), 'packages', 'cli', 'src', 'bin.ts')

    // If we're in __tests__ directory, adjust the path
    if (process.cwd().includes('__tests__')) {
      binPath = path.join(process.cwd(), '..', 'packages', 'cli', 'src', 'bin.ts')
    } else if (!fs.existsSync(binPath)) {
      // Try alternative path if the above doesn't work
      binPath = path.resolve(process.cwd(), 'packages', 'cli', 'src', 'bin.ts')
    }

    // Ensure the target directory exists
    const targetDir = args[0] || path.join(process.cwd(), '__tests__', '__mocks__', projectType, 'project')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // Note: seed.config.ts is no longer required
    // Projects can use empty config - models are defined in schema files

    const command = `npx tsx ${binPath} init ${args.join(' ')}`

    const output = execSync(command, {
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        IS_SEED_DEV: 'true',
      },
    }).toString()

    return output
  } catch (error: any) {
    console.error('Error running init command:', error.message)
    throw error
  }
}

export const runSeed = async (seedDataPath: string): Promise<string> => {
  try {
    process.env.IS_SEED_DEV = 'true'
    process.env.NODE_ENV = 'test'

    // Get the path to the CLI bin file
    let binPath = path.join(process.cwd(), 'packages', 'cli', 'src', 'bin.ts')

    // If we're in __tests__ directory, adjust the path
    if (process.cwd().includes('__tests__')) {
      binPath = path.join(process.cwd(), '..', 'packages', 'cli', 'src', 'bin.ts')
    } else if (!fs.existsSync(binPath)) {
      // Try alternative path if the above doesn't work
      binPath = path.resolve(process.cwd(), 'packages', 'cli', 'src', 'bin.ts')
    }

    const command = `npx tsx ${binPath} seed ${seedDataPath}`

    const output = execSync(command, {
      stdio: 'pipe',
      env: {
        ...process.env,
        IS_SEED_DEV: 'true',
        NODE_ENV: 'test',
      },
    }).toString()

    return output
  } catch (error: any) {
    console.error('Error running seed command:', error.message)
    throw error
  }
}
