import type { SessionClaims } from '@isp/contracts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionClaims;
  }

  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
