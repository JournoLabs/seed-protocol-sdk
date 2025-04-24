#!/usr/bin/env node

import fs from 'fs';
import { generateModelCode } from '../src/node/codegen/drizzle';

// Parse command line arguments
const args = process.argv.slice(2);
const sourceSchemaFilePath = args[0];
const outputFilePath = args[1];
const jsonString = args[2];

if (!sourceSchemaFilePath || !outputFilePath || !jsonString) {
  console.error('Usage: npx tsx bin/addModel.ts <source-schema-file-path> <output-file-path> <json-string>');
  process.exit(1);
}

// Read the contents of the file
let fileContents;
try {
  fileContents = fs.readFileSync(sourceSchemaFilePath, 'utf-8');
} catch (error) {
  console.error(`Error reading file at ${sourceSchemaFilePath}:`, error);
  process.exit(1);
}

// Parse the JSON string
let jsonModel;
try {
  jsonModel = JSON.parse(jsonString);
} catch (error) {
  console.error('Invalid JSON string:', error);
  process.exit(1);
}

/**
 * Simple function to inject a new model after the last model class and update the models object
 * @param {string} schemaContent - The content of the schema file
 * @param {string} newModelCode - The code for the new model to inject
 * @returns {string} The updated schema content
 */
const injectModel = (schemaContent: string, newModelCode: string) => {
  // Extract the model name from the new code
  const modelNameMatch = newModelCode.match(/class\s+(\w+)/);
  if (!modelNameMatch) {
    throw new Error("Could not extract model name from provided code");
  }
  const modelName = modelNameMatch[1];

  // Find the 'const models' position
  const modelsPos = schemaContent.indexOf('const models');
  if (modelsPos === -1) {
    throw new Error("Could not find 'const models' in the schema");
  }

  // Find the position of the last model class before 'const models'
  const lastClassPos = schemaContent.lastIndexOf('@Model', modelsPos);
  if (lastClassPos === -1) {
    throw new Error("Could not find any model declarations in the schema");
  }

  // Find the end of the last class
  const classEndPos = schemaContent.indexOf('}', lastClassPos);
  if (classEndPos === -1) {
    throw new Error("Could not find closing brace of the last model class");
  }

  // Find the position after the last class's closing brace
  const insertModelPos = schemaContent.indexOf('\n', classEndPos) + 1;
  
  // Insert the new model
  let updatedSchema = 
    schemaContent.slice(0, insertModelPos) + 
    "\n" + newModelCode + "\n\n" + 
    schemaContent.slice(insertModelPos);
  
  // Find the closing brace of the models object
  const modelsClosingBracePos = updatedSchema.indexOf('}', updatedSchema.indexOf('const models'));
  
  // Add the new model to the models object
  updatedSchema = 
    updatedSchema.slice(0, modelsClosingBracePos) + 
    `  ${modelName},\n` + 
    updatedSchema.slice(modelsClosingBracePos);
  
  return updatedSchema;
}

if (fileContents.includes(`class ${jsonModel.name}`)) {
  console.error(`Model with name ${jsonModel.name} already exists in the schema`);
  process.exit(0);
}

const newModelCode = generateModelCode({
  modelName: jsonModel.name,
  properties: jsonModel.properties,
});

const updatedSchema = injectModel(fileContents, newModelCode);

// Write the new table file
try {
  fs.writeFileSync(outputFilePath, updatedSchema, 'utf-8');
  console.log(`Wrote updated schema file to ${outputFilePath}`);
} catch (error) {
  console.error('Error writing Drizzle table file:', error);
  process.exit(1);
} 
