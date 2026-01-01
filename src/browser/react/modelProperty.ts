import { useModel } from "./model"
import { useCallback, useEffect, useRef, useState } from "react"
import { getPropertySchema } from "@/helpers/property"
import { ModelProperty } from "@/ModelProperty/ModelProperty"
import { useIsClientReady } from "./client"
import { Subscription } from "xstate"
import { useImmer } from "use-immer"
import { ModelPropertyMachineContext } from "@/ModelProperty/service/modelPropertyMachine"
import { ValidationError } from "@/Schema/validation"
import debug from "debug"

const logger = debug('seedSdk:browser:react:modelProperty')

export const useModelProperties = (modelName: string | undefined): ModelProperty[] => {
  const model = useModel(modelName)

  const isClientReady = useIsClientReady()
  const [modelProperties, setModelProperties] = useState<ModelProperty[]>([])

  useEffect(() => {
    if (!model || !model.schema || !modelName || !isClientReady) {
      setModelProperties([])
      return
    }

    const loadProperties = async () => {
      const modelPropertyDefinitions = Array.isArray(model.schema) 
        ? model.schema.map((item: any, index: number) => [index.toString(), item])
        : Object.entries(model.schema || {});

      const _modelProperties: ModelProperty[] = []

      for (const [propertyName, propertyDefinition] of modelPropertyDefinitions) {
        const modelPropertyData = await getPropertySchema(modelName, propertyName)
        if (modelPropertyData) {
          const modelProperty = ModelProperty.create({
            ...modelPropertyData,
            modelName,
          })
          _modelProperties.push(modelProperty)
        }
      }

      setModelProperties(_modelProperties)
    }

    loadProperties()
  }, [model, modelName, isClientReady]);

  return modelProperties;
}

export const useModelProperty = (modelName: string, propertyName: string) => {
  const [modelPropertyData, setModelPropertyData] = useImmer<ModelPropertyMachineContext | undefined>(undefined)
  const [modelProperty, setModelProperty] = useState<ModelProperty | undefined>(undefined)
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | undefined>(undefined)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const isClientReady = useIsClientReady()

  const updateModelProperty = useCallback(async (modelName: string, propertyName: string) => {
    const modelPropertyData = await getPropertySchema(modelName, propertyName)
    if (modelPropertyData) {
      const modelProperty = ModelProperty.create({
        ...modelPropertyData,
        modelName,
      })
      setModelProperty(modelProperty)
      setValidationErrors(modelProperty.validationErrors)
      setModelPropertyData((draft) => {
        if (draft) {
          const context = modelProperty.getService().getSnapshot().context
          Object.assign(draft, context)
        } else {
          setModelPropertyData(modelProperty.getService().getSnapshot().context)
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!isClientReady) {
      return
    }

    if (!modelProperty) {
      updateModelProperty(modelName, propertyName)
    }
  }, [modelName, propertyName, isClientReady, modelProperty, updateModelProperty])

  useEffect(() => {
    if (!modelProperty) {
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = modelProperty.getService().subscribe((snapshot) => {
      updateModelProperty(modelName, propertyName)
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [modelName, propertyName, modelProperty, updateModelProperty])

  return {
    modelPropertyData,
    modelProperty,
    validationErrors,
  }
}