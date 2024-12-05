import { config }   from 'dotenv'

config()




export const setup = async () => {
  console.log('Setup begin')



  console.log('Setup complete')
}

export const teardown = async () => {
  // mock.restore()
  console.log('Teardown complete')
}