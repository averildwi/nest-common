import * as Joi from 'joi';

export const baseEnvSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  // Comma-separated origins. Empty means no cross-origin access, never '*'.
  FRONTEND_URL: Joi.string().allow('').default(''),
  // HS256 needs at least 256 bits of key material.
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  // Number of reverse proxies in front of the app (0 = exposed directly).
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0),
});
