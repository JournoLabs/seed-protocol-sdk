import { describe, it, }           from 'vitest'
import { runAddModel, runInit } from '@/test/__fixtures__/scripts'
import { INIT_SCRIPT_SUCCESS_MESSAGE }         from '@/helpers/constants'


describe('addModel.ts', () => {

  it('should create a model definition from JSON', async ({expect}) => {

    const output = await runAddModel()

    expect(output).toContain('Wrote updated schema file to')
    expect(output).not.toContain('Error')

  }, 120000);

  it('works with bin.ts after adding model', async ({expect}) => {

    const initOutputBeginning = await runInit({projectType: 'node', args: []})

    const addModelOutput = await runAddModel()

    const initOutput = await runInit({projectType: 'node', args: []})

    expect(initOutput).toContain(INIT_SCRIPT_SUCCESS_MESSAGE)
  }, 120000)

});
