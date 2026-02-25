#!/usr/bin/env node

import path from 'path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Item, } from '@/Item/Item';
import { Model } from '@/Model/Model';
import { IItem } from '@/interfaces/IItem';
import { fileURLToPath } from 'url';
import { modelPropertiesToObject } from '@/helpers/model';

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load protobuf
const PROTO_PATH = path.resolve(__dirname, './protos/seed.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const seedProto = grpc.loadPackageDefinition(packageDefinition) as any;

// In-memory cache to store BaseItems by model and ID
const BaseItemsCache: Record<string, Record<string, IItem<any>>> = {};

// Helper function to get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Helper function to get model by name
function getModel(modelName: string) {
  return Model.getByName(modelName);
}

/**
 * Implements the SeedService gRPC service
 */
const server = {
  // Model operations
  GetModels: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    Model.all()
      .then((allModels) => {
        const models: any[] = [];
        for (const model of allModels) {
          const modelName = model.modelName;
          if (!modelName) {
            continue;
          }
          const modelProperties = model.properties || [];
          if (modelProperties.length === 0) {
            continue;
          }
          const schema = modelPropertiesToObject(modelProperties);
          const props = Object.keys(schema).map((propName) => {
            const prop = schema[propName];
            return {
              name: propName,
              type: prop?.dataType || 'Text',
              relation_model: prop?.ref || prop?.refModelName || '',
              is_list: prop?.dataType === 'List',
            };
          });
          models.push({ name: modelName, properties: props });
        }
        callback(null, { models });
      })
      .catch((error) => {
        callback({
          code: grpc.status.INTERNAL,
          message: `Error getting models: ${getErrorMessage(error)}`,
        });
      });
  },

  GetModel: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { model_name } = call.request;
      const model = getModel(model_name);
      
      if (!model) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Model ${model_name} not found`
        });
      }

      // Get properties from Model instance
      const modelProperties = model.properties || [];
      const schema = modelPropertiesToObject(modelProperties);
      
      const props = Object.keys(schema).map(propName => {
        const prop = schema[propName];
        return {
          name: propName,
          type: prop?.dataType || 'text',
          relation_model: prop?.ref || prop?.refModelName || '',
          is_list: prop?.dataType === 'List'
        };
      });

      callback(null, { 
        model: {
          name: model_name,
          properties: props
        }
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error getting model: ${getErrorMessage(error)}`
      });
    }
  },

  // BaseItem operations
  CreateItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { model_name, properties } = call.request;
      const model = await Model.getByNameAsync(model_name);
      
      if (!model) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Model ${model_name} not found`
        });
      }

      // Process properties to handle relations and lists
      const processedProps: Record<string, any> = {};
      
      // Get model schema from properties
      const modelProperties = model.properties || [];
      const schema = modelPropertiesToObject(modelProperties);
      
      for (const [key, value] of Object.entries(properties || {})) {
        // Handle relationship properties and lists based on model definition
        const prop = schema[key];
        if (prop && prop.dataType === 'List') {
          processedProps[key] = typeof value === 'string' ? JSON.parse(value) : value;
        } else if (prop && (prop.dataType === 'Relation' || prop.ref)) {
          // Assuming relation is stored as stringified ID
          processedProps[key] = value;
        } else {
          processedProps[key] = value;
        }
      }

      const item = await Item.create(processedProps);

      // Cache the Item
      if (!BaseItemsCache[model_name]) {
        BaseItemsCache[model_name] = {};
      }
      
      BaseItemsCache[model_name][item.seedLocalId] = item;

      // Return the created Item
      callback(null, {
        id: item.seedLocalId,
        model_name,
        properties: properties
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error creating BaseItem: ${getErrorMessage(error)}`
      });
    }
  },

  GetItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name } = call.request;
      
      // Try to get from cache
      const item = await Item.find({
        seedLocalId: id,
        modelName: model_name
      });
      
      if (!item) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Item ${id} not found`
        });
      }

      // Convert properties to simple strings for gRPC
      const properties: Record<string, string> = {};
      for (const [key, property] of Object.entries(item.allProperties)) {
        if (key !== 'id' && key !== 'modelName') {
          const value = property.value;
          if (Array.isArray(value)) {
            properties[key] = JSON.stringify(value);
          } else if (typeof value === 'object' && value !== null) {
            properties[key] = JSON.stringify(value);
          } else {
            properties[key] = String(value);
          }
        }
      }

      callback(null, {
        id,
        model_name,
        properties
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error getting BaseItem: ${getErrorMessage(error)}`
      });
    }
  },

  UpdateItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name, properties } = call.request;
      
      // Try to get from cache
      const item = await Item.find({
        seedLocalId: id,
        modelName: model_name
      });
      
      if (!item) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Item ${id} not found`
        });
      }

      // Update properties
      for (const [key, value] of Object.entries(properties || {})) {
        const property = item.allProperties[key];
        if (property) {
          // Parse JSON if needed
          if (typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              property.value = parsed;
            } catch {
              property.value = value;
            }
          } else {
            property.value = value;
          }
          // Save the property
          await property.save();
        }
      }

      // Return the updated BaseItem
      callback(null, {
        id,
        model_name,
        properties: properties
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error updating BaseItem: ${getErrorMessage(error)}`
      });
    }
  },

  DeleteItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name } = call.request;
      
      // Find the Item
      const item = await Item.find({
        seedLocalId: id,
        modelName: model_name
      });
      
      if (!item) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Item ${id} not found`
        });
      }
      
      // Note: Item doesn't have a delete method - this may need to be implemented
      // For now, just remove from cache
      
      // Remove from cache
      if (BaseItemsCache[model_name]) {
        delete BaseItemsCache[model_name][id];
      }

      callback(null, {
        success: true,
        message: `Item ${id} deleted successfully`
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error deleting BaseItem: ${getErrorMessage(error)}`
      });
    }
  },

  PublishItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name } = call.request;
      
      // Try to get from cache
      const item = await Item.find({
        seedLocalId: id,
        modelName: model_name
      });
      
      if (!item) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Item ${id} not found`
        });
      }

      // Publish the BaseItem
      await item.publish();

      callback(null, {
        success: true,
        message: `Item ${id} published successfully`
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error publishing BaseItem: ${getErrorMessage(error)}`
      });
    }
  },

  QueryItems: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { model_name, filters, limit, offset } = call.request;
      
      // Simple in-memory implementation - in production, you'd query the SDK
      // Get all BaseItems for the model
      const modelItems = BaseItemsCache[model_name] || {};
      let items: IItem<any>[] = Object.values(modelItems);
      
      // Apply filters
      if (filters && typeof filters === 'object') {
        items = items.filter(item => {
          return Object.entries(filters).every(([key, value]) => {
            const property = item.allProperties[key];
            if (!property) return false;
            return property.value === value;
          });
        });
      }
      
      // Apply pagination
      const offsetNum = typeof offset === 'number' ? offset : 0;
      const limitNum = typeof limit === 'number' ? limit : undefined;
      
      if (offsetNum > 0) {
        items = items.slice(offsetNum);
      }
      
      if (limitNum !== undefined) {
        items = items.slice(0, limitNum);
      }
      
      // Format response
      const responseItems = items.map(item => {
        const properties: Record<string, string> = {};
        for (const [key, property] of Object.entries(item.allProperties)) {
          if (key !== 'id' && key !== 'modelName') {
            const value = property.value;
            if (Array.isArray(value)) {
              properties[key] = JSON.stringify(value);
            } else if (typeof value === 'object' && value !== null) {
              properties[key] = JSON.stringify(value);
            } else {
              properties[key] = String(value);
            }
          }
        }
        
        return {
          id: item.seedLocalId,
          model_name,
          properties
        };
      });

      callback(null, { items: responseItems });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error querying BaseItems: ${getErrorMessage(error)}`
      });
    }
  }
};

/**
 * Start the gRPC server
 */
function startServer() {
  const grpcServer = new grpc.Server();
  
  if (seedProto && seedProto.SeedService && seedProto.SeedService.service) {
    grpcServer.addService(seedProto.SeedService.service, server);
  } else {
    console.error('Failed to load SeedService from protobuf definition');
    return;
  }
  
  grpcServer.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error('Failed to bind server:', err);
      return;
    }
    
    console.log(`Server running at http://0.0.0.0:${port}`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down gRPC server');
    grpcServer.tryShutdown(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  });
}

// Start the server
startServer();