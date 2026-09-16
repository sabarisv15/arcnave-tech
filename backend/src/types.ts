/**
 * Shared Fastify instance type, so route modules do not each re-derive the generics.
 *
 * The logger parameter is our concrete pino instance rather than `FastifyBaseLogger`: passing
 * `loggerInstance` to Fastify narrows the type, and a mismatch here makes every route file
 * fail to assign.
 */
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Logger } from './logger.js';

export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger,
  ZodTypeProvider
>;
