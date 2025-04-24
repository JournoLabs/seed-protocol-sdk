import path                from 'path'
import { execSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const testModel = {
  name: 'TestModel',
  properties: [
    {
      type: 'Text',
      name: 'name',
    },
    {
      type: 'Date',
      name: 'birthdate',
    },
    {
      type: 'Number',
      name: 'age',
    },
    {
      type: 'Boolean',
      name: 'isAlive',
    },
    {
      type: 'List',
      name: 'nicknames',
      ref: 'Text',
    },
    {
      type: 'Relation',
      name: 'bestFriend',
      targetModel: 'TestModel',
    },
    {
      type: 'List',
      name: 'friends',
      targetModel: 'TestModel',
    },
    {
      type: 'Image',
      name: 'profilePic',
    },
    {
      type: 'File',
      name: 'resume',
      storageType: 'ItemStorage',
      storagePath: '/resumes',
    }
  ]
}

type RunCommandWithOutputArgs = {
  command: string,
  args: string[],
  options: {}
}

type RunCommandWithOutput = (args: RunCommandWithOutputArgs) => Promise<string>

export const runCommandWithOutput: RunCommandWithOutput = async ({command, args, options}) => {
  let output = ''

  await new Promise<void>((resolve) => {
    const {stdout, stderr} = spawn(
      command,
      args,
      options,
    );

    stdout.on('data', (data) => {
      output += data.toString()
    });
    stderr.on('data', (data) => {
      output += data.toString()
    });
    stdout.on('close', () => {
      resolve()
    })
  }).catch((err) => {
    console.error(err)
  })

  return output
}

export const runAddModel = async () => {
  const projectRoot = path.resolve(process.cwd(),)
  const addModelPath = path.resolve(projectRoot, 'scripts', 'addModel.ts');
  const nodeProjectDir = path.resolve(projectRoot, '__tests__', '__mocks__', 'node', 'project',)
  const schemaDirPath = path.resolve(nodeProjectDir);
  const dotSeedDir = path.resolve(nodeProjectDir, '.seed');
  const sourceSchemaFilePath = path.resolve(schemaDirPath, 'schema.ts');
  const outputFilePath = path.resolve(dotSeedDir, 'schemaTestOutput.ts');

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

    let binPath = path.join(process.cwd(), 'scripts', 'bin.ts')

    if (binPath.includes('__tests__')) {
      binPath = path.join(process.cwd(), '..', '..', '..', '..', 'scripts', 'bin.ts')
    }

    const command = `npx tsx ${binPath} init ${args.join(' ')}`

    const output = execSync(command, {
      stdio: 'pipe',
      env: {
        ...process.env,
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

    const binPath = path.join(process.cwd(), 'scripts', 'bin.ts')
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
