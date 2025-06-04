/**
 * Constants for mint/burn config property names
 * These can be used across tests to avoid string literals and improve type safety
 */
export const CONFIG_PROPERTIES = {
  FIXED_AMOUNT: 'fixedAmount',
  RANGED_AMOUNT: 'rangedAmount',
  UNAUTHORIZED: 'unauthorized',
} as const;

/**
 * Constants for mint/burn params property names
 */
export const PARAMS_PROPERTIES = {
  FIXED_AMOUNT: 'fixedAmount',
  MIN_AMOUNT: 'minAmount',
  MAX_AMOUNT: 'maxAmount',
} as const;

/**
 * Type definitions for better type safety
 */
export type ConfigProperty = typeof CONFIG_PROPERTIES[keyof typeof CONFIG_PROPERTIES];
export type ParamsProperty = typeof PARAMS_PROPERTIES[keyof typeof PARAMS_PROPERTIES];

/**
 * All available config properties as a typed array
 * Useful for iteration or validation
 */
export const ALL_CONFIG_PROPERTIES = Object.values(CONFIG_PROPERTIES) as ConfigProperty[];

/**
 * All available params properties as a typed array
 * Useful for iteration or validation
 */
export const ALL_PARAMS_PROPERTIES = Object.values(PARAMS_PROPERTIES) as ParamsProperty[]; 