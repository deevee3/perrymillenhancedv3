import { createLocalJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from './env';

const jwksCache: { jwks?: ReturnType<typeof createLocalJWKSet> } = {};

export async function verifyJWT(token: string) {
  if (!jwksCache.jwks) {
    const res = await fetch(ENV.jwksUrl);
    const jwks = await res.json();
    jwksCache.jwks = createLocalJWKSet(jwks);
  }
  const { payload } = await jwtVerify(token, jwksCache.jwks!, {
    issuer: undefined,
    audience: undefined
  });
  return payload;
}

export function requireAuth<T>(handler: (ctx: { userId: string; req: FastifyRequest; reply: FastifyReply }) => Promise<T>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      if (process.env.NODE_ENV === 'test') {
        return handler({ userId: 'test-user', req, reply });
      }
      const payload = await verifyJWT(token);
      return handler({ userId: String(payload.sub), req, reply });
    } catch (err) {
      req.log.error({ err }, 'jwt verification failed');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

export function requireServiceKey<T>(handler: (req: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers['x-service-key'] !== ENV.serviceKey) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return handler(req, reply);
  };
}
