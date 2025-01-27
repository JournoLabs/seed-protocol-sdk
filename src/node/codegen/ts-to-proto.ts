import { Decorator, Project } from 'ts-morph'
import { Field, Type } from 'protobufjs'
import fs from 'fs'

type TsToProtoOptions = {
  tsFilePath: string
  tsConfigPath: string
  outputFilePath: string
}

type TsToProto = (options: TsToProtoOptions) => void

export const tsToProto: TsToProto = ({
  tsFilePath,
  tsConfigPath,
  outputFilePath,
}) => {
  // Initialize the TypeScript project
  const project = new Project({
    tsConfigFilePath: tsConfigPath,
  })

  // Add the source file
  const sourceFile = project.addSourceFileAtPath(tsFilePath)

  // Helper function to extract decorator arguments
  const getDecoratorArgument = (decorator: Decorator): string => {
    const callExpression = decorator.getCallExpression()
    if (callExpression) {
      const args = callExpression.getArguments()
      if (args.length > 0) {
        return args[0].getText().replace(/['"]/g, '')
      }
    }
    return ''
  }

  // Process each class
  const classes = sourceFile.getClasses()
  const protoClasses: { [key: string]: Type } = {}

  classes.forEach((cls) => {
    const className = cls.getName()
    if (!className) {
      throw new Error('Class name not found')
    }
    const type = new Type(className)

    // Process each property
    cls.getProperties().forEach((prop, index) => {
      const propName = prop.getName()
      const decorators = prop.getDecorators()

      decorators.forEach((decorator) => {
        const decoratorName = decorator.getName()
        switch (decoratorName) {
          case 'Text':
            type.add(new Field(propName, type.fieldsArray.length + 1, 'string'))
            break
          case 'ImageSrc':
            type.add(new Field(propName, type.fieldsArray.length + 1, 'string'))
            break
          case 'Relation':
            const relatedType = getDecoratorArgument(decorator)
            type.add(
              new Field(propName, type.fieldsArray.length + 1, relatedType),
            )
            break
          case 'List':
            const listType = getDecoratorArgument(decorator)
            type.add(
              new Field(
                propName,
                type.fieldsArray.length + 1,
                listType,
                'repeated',
              ),
            )
            break
          default:
            break
        }
      })
    })

    protoClasses[className] = type
  })

  // Generate .proto content
  let protoContent = 'syntax = "proto3";\n\n'
  Object.values(protoClasses).forEach((type) => {
    protoContent += `message ${type.name} {\n`
    for (const field of type.fieldsArray) {
      protoContent += `  ${field.repeated ? 'repeated' : ''} ${field.type} ${field.name} = ${field.id};\n`
    }
    protoContent += '}\n'
  })

  // Write to .proto file
  fs.writeFileSync(outputFilePath, protoContent)
}
