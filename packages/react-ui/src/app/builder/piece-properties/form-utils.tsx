import { TSchema, Type } from '@sinclair/typebox';

import {
  CONNECTION_REGEX,
  OAuth2Props,
  PieceAuthProperty,
  PieceMetadata,
  PieceMetadataModel,
  PiecePropertyMap,
  PropertyType,
} from '@activepieces/pieces-framework';
import {
  Action,
  ActionType,
  BranchActionSchema,
  BranchOperator,
  CodeActionSchema,
  LoopOnItemsActionSchema,
  PieceActionSchema,
  PieceActionSettings,
  PieceTrigger,
  PieceTriggerSettings,
  Trigger,
  TriggerType,
  ValidBranchCondition,
  isNil,
  spreadIfDefined,
} from '@activepieces/shared';

function addAuthToPieceProps(
  props: PiecePropertyMap,
  auth: PieceAuthProperty | undefined,
): PiecePropertyMap {
  return {
    ...props,
    ...spreadIfDefined('auth', auth),
  };
}

function buildInputSchemaForStep(
  type: ActionType | TriggerType,
  piece: PieceMetadata | null,
  actionNameOrTriggerName: string,
): TSchema {
  switch (type) {
    case ActionType.PIECE: {
      if (
        piece &&
        actionNameOrTriggerName &&
        piece.actions[actionNameOrTriggerName]
      ) {
        return formUtils.buildSchema(
          addAuthToPieceProps(
            piece.actions[actionNameOrTriggerName].props,
            piece.auth,
          ),
        );
      }
      return Type.Object({});
    }
    case TriggerType.PIECE: {
      if (
        piece &&
        actionNameOrTriggerName &&
        piece.triggers[actionNameOrTriggerName]
      ) {
        return formUtils.buildSchema(
          addAuthToPieceProps(
            piece.triggers[actionNameOrTriggerName].props,
            piece.auth,
          ),
        );
      }
      return Type.Object({});
    }
    default:
      throw new Error('Unsupported type: ' + type);
  }
}

export const formUtils = {
  buildPieceDefaultValue: (
    selectedStep: Action | Trigger,
    piece: PieceMetadata | null,
    includeCurrentInput: boolean,
  ): Action | Trigger => {
    const { type } = selectedStep;
    const defaultErrorOptions = {
      continueOnFailure: {
        value:
          selectedStep.settings.errorHandlingOptions?.continueOnFailure
            ?.value ?? false,
      },
      retryOnFailure: {
        value:
          selectedStep.settings.errorHandlingOptions?.retryOnFailure?.value ??
          false,
      },
    };
    switch (type) {
      case ActionType.LOOP_ON_ITEMS:
        return {
          ...selectedStep,
          settings: {
            ...selectedStep.settings,
            items: selectedStep.settings.items ?? '',
          },
        };
      case ActionType.BRANCH:
        return {
          ...selectedStep,
          settings: {
            ...selectedStep.settings,
            conditions: selectedStep.settings.conditions ?? [
              [
                {
                  operator: BranchOperator.TEXT_EXACTLY_MATCHES,
                  firstValue: '',
                  secondValue: '',
                  caseSensitive: false,
                },
              ],
            ],
            inputUiInfo: {},
          },
        };
      case ActionType.CODE: {
        const defaultCode = `export const code = async (inputs) => {
  return true;
};`;
        return {
          ...selectedStep,
          settings: {
            ...selectedStep.settings,
            sourceCode: {
              code: selectedStep.settings.sourceCode.code ?? defaultCode,
              packageJson: selectedStep.settings.sourceCode.packageJson ?? '{}',
            },
            errorHandlingOptions: defaultErrorOptions,
          },
        };
      }
      case ActionType.PIECE: {
        const actionName = selectedStep?.settings?.actionName;
        const actionPropsWithoutAuth =
          actionName !== undefined
            ? piece?.actions?.[actionName]?.props ?? {}
            : {};
        const props = addAuthToPieceProps(actionPropsWithoutAuth, piece?.auth);
        const input = (selectedStep?.settings?.input ?? {}) as Record<
          string,
          unknown
        >;
        const defaultValues = getDefaultValueForStep(
          props ?? {},
          includeCurrentInput ? input : {},
        );
        return {
          ...selectedStep,
          settings: {
            ...selectedStep.settings,
            input: defaultValues,
            errorHandlingOptions: defaultErrorOptions,
          },
        };
      }
      case TriggerType.PIECE: {
        const triggerName = selectedStep?.settings?.triggerName;
        const triggerPropsWithoutAuth =
          triggerName !== undefined
            ? piece?.triggers?.[triggerName]?.props ?? {}
            : {};
        const props = addAuthToPieceProps(triggerPropsWithoutAuth, piece?.auth);
        const input = (selectedStep?.settings?.input ?? {}) as Record<
          string,
          unknown
        >;
        const defaultValues = getDefaultValueForStep(
          props ?? {},
          includeCurrentInput ? input : {},
        );

        return {
          ...selectedStep,
          settings: {
            ...selectedStep.settings,
            input: defaultValues,
          },
        };
      }
      default:
        throw new Error('Unsupported type: ' + type);
    }
  },
  buildPieceSchema: (
    type: ActionType | TriggerType,
    actionNameOrTriggerName: string,
    piece: PieceMetadataModel | null,
  ) => {
    switch (type) {
      case ActionType.LOOP_ON_ITEMS:
        return Type.Composite([
          LoopOnItemsActionSchema,
          Type.Object({
            settings: Type.Object({
              items: Type.String({
                minLength: 1,
              }),
            }),
          }),
        ]);
      case ActionType.BRANCH:
        return Type.Composite([
          BranchActionSchema,
          Type.Object({
            settings: Type.Object({
              conditions: Type.Array(Type.Array(ValidBranchCondition)),
            }),
          }),
        ]);
      case ActionType.CODE:
        return CodeActionSchema;
      case ActionType.PIECE: {
        return Type.Composite([
          Type.Omit(PieceActionSchema, ['settings']),
          Type.Object({
            settings: Type.Composite([
              Type.Omit(PieceActionSettings, ['input', 'actionName']),
              Type.Object({
                actionName: Type.String({
                  minLength: 1,
                }),
                input: buildInputSchemaForStep(
                  type,
                  piece,
                  actionNameOrTriggerName,
                ),
              }),
            ]),
          }),
        ]);
      }
      case TriggerType.PIECE: {
        return Type.Composite([
          Type.Omit(PieceTrigger, ['settings']),
          Type.Object({
            settings: Type.Composite([
              Type.Omit(PieceTriggerSettings, ['input', 'triggerName']),
              Type.Object({
                triggerName: Type.String({
                  minLength: 1,
                }),
                input: buildInputSchemaForStep(
                  type,
                  piece,
                  actionNameOrTriggerName,
                ),
              }),
            ]),
          }),
        ]);
      }
      default: {
        throw new Error('Unsupported type: ' + type);
      }
    }
  },
  buildSchema: (props: PiecePropertyMap) => {
    const entries = Object.entries(props);
    const nonNullableUnknownPropType = Type.Not(
      Type.Union([Type.Null(), Type.Undefined()]),
      Type.Unknown(),
    );
    const propsSchema: Record<string, TSchema> = {};
    for (const [name, property] of entries) {
      switch (property.type) {
        case PropertyType.MARKDOWN:
          propsSchema[name] = Type.Optional(
            Type.Union([
              Type.Null(),
              Type.Undefined(),
              Type.Never(),
              Type.Unknown(),
            ]),
          );
          break;
        case PropertyType.DATE_TIME:
        case PropertyType.SHORT_TEXT:
        case PropertyType.LONG_TEXT:
        case PropertyType.FILE:
          propsSchema[name] = Type.String({
            minLength: property.required ? 1 : undefined,
          });
          break;
        case PropertyType.CHECKBOX:
          propsSchema[name] = Type.Union([
            Type.Boolean(),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        case PropertyType.NUMBER:
          // Because it could be a variable
          propsSchema[name] = Type.Union([
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
            Type.Number(),
          ]);
          break;
        case PropertyType.STATIC_DROPDOWN:
          propsSchema[name] = nonNullableUnknownPropType;
          break;
        case PropertyType.DROPDOWN:
          propsSchema[name] = nonNullableUnknownPropType;
          break;
        case PropertyType.BASIC_AUTH:
        case PropertyType.CUSTOM_AUTH:
        case PropertyType.SECRET_TEXT:
        case PropertyType.OAUTH2:
          // Only accepts connections variable.
          propsSchema[name] = Type.Union([
            Type.String({
              pattern: CONNECTION_REGEX,
              minLength: property.required ? 1 : undefined,
            }),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        case PropertyType.ARRAY: {
          const arraySchema = isNil(property.properties)
            ? Type.Unknown()
            : formUtils.buildSchema(property.properties);
          // Only accepts connections variable.
          propsSchema[name] = Type.Union([
            Type.Array(arraySchema, {
              minItems: property.required ? 1 : undefined,
            }),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        }
        case PropertyType.OBJECT:
          propsSchema[name] = Type.Union([
            Type.Record(Type.String(), Type.Any()),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        case PropertyType.JSON:
          propsSchema[name] = Type.Union([
            Type.Record(Type.String(), Type.Any()),
            Type.Array(Type.Any()),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        case PropertyType.MULTI_SELECT_DROPDOWN:
        case PropertyType.STATIC_MULTI_SELECT_DROPDOWN:
          propsSchema[name] = Type.Union([
            Type.Array(Type.Any()),
            Type.String({
              minLength: property.required ? 1 : undefined,
            }),
          ]);
          break;
        case PropertyType.DYNAMIC:
          propsSchema[name] = Type.Record(Type.String(), Type.Any());
          break;
      }

      if (!property.required) {
        propsSchema[name] = Type.Optional(
          Type.Union([Type.Null(), Type.Undefined(), propsSchema[name]]),
        );
      }
    }

    return Type.Object(propsSchema);
  },
  getDefaultValueForStep,
};

function getDefaultValueForStep(
  props: PiecePropertyMap | OAuth2Props,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const defaultValues: Record<string, unknown> = {};
  const entries = Object.entries(props);
  for (const [name, property] of entries) {
    switch (property.type) {
      case PropertyType.CHECKBOX:
        defaultValues[name] = input[name] ?? property.defaultValue ?? false;
        break;
      case PropertyType.ARRAY:
        defaultValues[name] = input[name] ?? property.defaultValue ?? [];
        break;
      case PropertyType.MARKDOWN:
      case PropertyType.DATE_TIME:
      case PropertyType.SHORT_TEXT:
      case PropertyType.LONG_TEXT:
      case PropertyType.FILE:
      case PropertyType.STATIC_DROPDOWN:
      case PropertyType.DROPDOWN:
      case PropertyType.BASIC_AUTH:
      case PropertyType.CUSTOM_AUTH:
      case PropertyType.SECRET_TEXT:
      case PropertyType.OAUTH2: {
        defaultValues[name] = input[name] ?? property.defaultValue;
        break;
      }
      case PropertyType.JSON: {
        defaultValues[name] = input[name] ?? property.defaultValue;
        break;
      }
      case PropertyType.NUMBER: {
        defaultValues[name] = input[name] ?? property.defaultValue;
        break;
      }
      case PropertyType.MULTI_SELECT_DROPDOWN:
        defaultValues[name] = input[name] ?? property.defaultValue ?? [];
        break;
      case PropertyType.STATIC_MULTI_SELECT_DROPDOWN:
        defaultValues[name] = input[name] ?? property.defaultValue ?? [];
        break;
      case PropertyType.OBJECT:
      case PropertyType.DYNAMIC:
        defaultValues[name] = input[name] ?? property.defaultValue ?? {};
        break;
    }
  }
  return defaultValues;
}
