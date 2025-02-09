import 'dotenv/config'
import { execSync } from 'child_process'


export const setup = async () => {
  console.log('Setup begin')

  console.log('Running init script')

  execSync(`rm -rf ./__tests__/__mocks__/node/project/.seed`, {stdio: 'inherit'})
  execSync(`rm -rf ./__tests__/__mocks__/browser/project/.seed`, {stdio: 'inherit'})

  execSync(`npx tsx ./scripts/bin.ts init ./__tests__/__mocks__/node/project`, {stdio: 'inherit'})

  console.log('Finished running init script')

  console.log('Setup complete')
}

export const teardown = async () => {
  // mock.restore()
  console.log('Teardown complete')

  execSync(`rm -rf ./__tests__/__mocks__/node/project/.seed`, {stdio: 'inherit'})
  execSync(`rm -rf ./__tests__/__mocks__/browser/project/.seed`, {stdio: 'inherit'})
}
