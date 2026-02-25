import typia from 'typia';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const generateServiceDefinition = (service) => {
  const methods = service.methods.map(method => {
    return `  rpc ${method.name} (${method.inputType}) returns (${method.outputType});`;
  }).join('\n');

  return `service ${service.name} {
${methods}
}`;
}

export const typiaProto = (options) => {
  return {
    name: 'typia-proto',
    buildEnd() {
      // Create output directory if it doesn't exist
      if (!existsSync(options.outDir)) {
        mkdirSync(options.outDir, { recursive: true });
      }

      // Generate main proto file with service definitions
      let mainProtoContent = `syntax = "proto3";\n\npackage ${options.package};\n\n`;

      // Add service definitions if provided
      if (options.services) {
        for (const service of options.services) {
          mainProtoContent += generateServiceDefinition(service);
          mainProtoContent += '\n';
        }
      }

      // Generate message types
      for (const input of options.input) {
        const sourceCode = readFileSync(input.path, 'utf8');
        
        // For each type in the file, generate its protobuf message
        for (const typeName of input.types) {
          try {
            // Use typia's compile-time type information
            const protoMessage = typia.protobuf.message(typeName);
            if (protoMessage) {
              mainProtoContent += `\n// Message for type: ${typeName}\n`;
              mainProtoContent += protoMessage;
              mainProtoContent += '\n';
            }
          } catch (error) {
            console.error(`Error generating proto for type ${typeName} in ${input.path}:`, error);
            console.error('Make sure the type is decorated with typia tags if needed');
          }
        }
      }

      // Write the combined proto file
      const outFile = join(options.outDir, 'seed.proto');
      writeFileSync(outFile, mainProtoContent, 'utf8');
    }
  };
}