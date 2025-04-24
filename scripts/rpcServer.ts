#!/usr/bin/env node

import path from 'path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { BaseItem, } from '@/Item/BaseItem';
import { getModels, getModel, getModelNames, } from '@/stores/modelClass';
import { fileURLToPath } from 'url';

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

const seedProto = grpc.loadPackageDefinition(packageDefinition).seed;

// In-memory cache to store BaseItems by model and ID
const BaseItemsCache = {};

/**
 * Implements the SeedService gRPC service
 */
const server = {
  // Model operations
  GetModels: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const modelNames = getModelNames();

      const models = [];

      for (const modelName of modelNames) {
        const model = getModel(modelName);
        if (!model) {
          continue;
        }
        const props = Object.keys(model.schema).map(propName => {
          const prop = model.schema[propName];
          return {
            name: propName,
            type: prop?.dataType || 'Text',
            relation_model: prop?.refModelId ? getModel(prop.ref) : '',
            is_list: prop?.dataType === 'List'
          };
        });

        models.push({
          name: modelName,
          properties: props
        });
      }

      callback(null, { models });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error getting models: ${error.message}`
      });
    }
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

      const props = Object.keys(model.prototype).map(propName => {
        const prop = model.prototype[propName];
        return {
          name: propName,
          type: prop.type || 'text',
          relation_model: prop.relationModel || '',
          is_list: prop.isList || false
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
        message: `Error getting model: ${error.message}`
      });
    }
  },

  // BaseItem operations
  CreateItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { model_name, properties } = call.request;
      const ModelClass = getModel(model_name);
      
      if (!ModelClass) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Model ${model_name} not found`
        });
      }

      // Process properties to handle relations and lists
      const processedProps = {};
      for (const [key, value] of Object.entries(properties)) {
        // Handle relationship properties and lists based on model definition
        const prop = ModelClass.prototype[key];
        if (prop && prop.isList) {
          processedProps[key] = JSON.parse(value);
        } else if (prop && prop.relationModel) {
          // Assuming relation is stored as stringified ID
          processedProps[key] = value;
        } else {
          processedProps[key] = value;
        }
      }

      const item = await BaseItem.create(processedProps);

      // Cache the BaseItem
      if (!itemsCache[model_name]) {
        BaseItemsCache[model_name] = {};
      }
      
      BaseItemsCache[model_name][item.id] = BaseItem;

      // Return the created BaseItem
      callback(null, {
        id: BaseItem.id,
        model_name,
        properties: properties
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error creating BaseItem: ${error.message}`
      });
    }
  },

  GetItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name } = call.request;
      
      // Try to get from cache
      const item = await BaseItem.find({
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
      const properties = {};
      for (const [key, value] of Object.entries(item)) {
        if (key !== 'id' && key !== 'modelName') {
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
        message: `Error getting BaseItem: ${error.message}`
      });
    }
  },

  UpdateItem: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    try {
      const { id, model_name, properties } = call.request;
      
      // Try to get from cache
      let item = await BaseItem.find({
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
      for (const [key, value] of Object.entries(properties)) {
        const prop = BaseItem.constructor.prototype[key];
        if (prop && prop.isList) {
          item[key] = JSON.parse(value);
        } else if (prop && prop.relationModel) {
          item[key] = value;
        } else {
          item[key] = value;
        }
      }

      // Save the updated BaseItem
      await BaseItem.save();

      // Return the updated BaseItem
      callback(null, {
        id,
        model_name,
        properties: properties
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error updating BaseItem: ${error.message}`
      });
    }
  },

  DeleteItem: async (call, callback) => {
    try {
      const { id, model_name } = call.request;
      
      // Try to get from cache
      const BaseItem = BaseItemsCache[model_name]?.[id];
      
      if (!item) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: `Item ${id} not found`
        });
      }

      // Delete the BaseItem
      await BaseItem.delete();
      
      // Remove from cache
      delete BaseItemsCache[model_name][id];

      callback(null, {
        success: true,
        message: `Item ${id} deleted successfully`
      });
    } catch (error) {
      callback({
        code: grpc.status.INTERNAL,
        message: `Error deleting BaseItem: ${error.message}`
      });
    }
  },

  PublishItem: async (call, callback) => {
    try {
      const { id, model_name } = call.request;
      
      // Try to get from cache
      const item = await BaseItem.find({
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
        message: `Error publishing BaseItem: ${error.message}`
      });
    }
  },

  QueryItems: async (call, callback) => {
    try {
      const { model_name, filters, limit, offset } = call.request;
      
      // Simple in-memory implementation - in production, you'd query the SDK
      // Get all BaseItems for the model
      const modelItems = BaseItemsCache[model_name] || {};
      let items = Object.values(modelItems);
      
      // Apply filters
      if (filters) {
        items = items.filter(item => {
          return Object.entries(filters).every(([key, value]) => {
            return item[key] === value;
          });
        });
      }
      
      // Apply pagination
      if (offset) {
        items = items.slice(offset);
      }
      
      if (limit) {
        items = items.slice(0, limit);
      }
      
      // Format response
      const responseItems = items.map(item => {
        const properties = {};
        for (const [key, value] of Object.entries(item)) {
          if (key !== 'id' && key !== 'modelName') {
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
        message: `Error querying BaseItems: ${error.message}`
      });
    }
  }
};

/**
 * Start the gRPC server
 */
function startServer() {
  const grpcServer = new grpc.Server();
  
  grpcServer.addService(seedProto.SeedService.service, server);
  
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