import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { db, schema } from './db';
import { requireAuth, requireServiceKey } from './auth';
import { eq } from 'drizzle-orm';
import { ENV } from './env';
import { DbArticlesRepository, type ArticlesRepository } from './repositories/articles';
import { createIngestService, type IngestService } from './services/ingest';

export interface AppDependencies {
  articlesRepo?: ArticlesRepository;
  ingestService?: IngestService;
}

export function buildApp(options: FastifyServerOptions = {}, deps: AppDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: true, ...options });
  const articlesRepo = deps.articlesRepo ?? new DbArticlesRepository();
  const ingestService = deps.ingestService ?? createIngestService();

  app.register(cors, { origin: true });

  app.get('/v1/health', async () => ({ ok: true }));

  app.get(
    '/v1/articles',
    requireAuth(async ({ req }) => {
      const query = (req.query ?? {}) as Record<string, string | undefined>;
      const feedId = query.feedId;
      const search = query.q;
      const rawPage = Number(query.page ?? 1);
      const rawPageSize = Number(query.pageSize ?? 20);

      const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
      const pageSizeCandidate = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.floor(rawPageSize) : 20;
      const pageSize = Math.min(100, pageSizeCandidate);
      const offset = (page - 1) * pageSize;

      const [items, total] = await Promise.all([
        articlesRepo.list({ feedId, search, limit: pageSize, offset }),
        articlesRepo.count({ feedId, search })
      ]);

      return {
        items,
        page,
        pageSize,
        total
      };
    })
  );

  app.get(
    '/v1/articles/:id',
    requireAuth(async ({ req, reply }) => {
      const params = (req.params ?? {}) as { id?: string };
      const id = params.id;
      if (!id) {
        return reply.code(400).send({ error: 'Invalid id' });
      }

      const article = await articlesRepo.findById(id);
      if (!article) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return article;
    })
  );

  app.post(
    '/v1/articles/:id/save',
    requireAuth(async ({ userId }) => ({}))
  );

  app.delete(
    '/v1/articles/:id/save',
    requireAuth(async ({ userId }) => ({}))
  );

  app.get(
    '/v1/feeds',
    requireAuth(async () => [])
  );

  app.post(
    '/v1/feeds',
    requireAuth(async () => ({}))
  );

  app.post(
    '/v1/ingest/rss',
    requireServiceKey(async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const feedUrl = typeof body.feed_url === 'string' ? body.feed_url.trim() : '';
      const link = typeof body.link === 'string' ? body.link.trim() : '';
      if (!feedUrl || !link) {
        return reply.code(400).send({ error: 'feed_url and link are required' });
      }

      const result = await ingestService.ingestRss({
        feedUrl,
        guid: typeof body.guid === 'string' ? body.guid : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        link,
        publishedAt: typeof body.published_at === 'string' ? body.published_at : undefined
      });

      reply.code(202).send({ accepted: true, created: result.created });
    })
  );

  app.post(
    '/v1/ingest/fulltext',
    requireServiceKey(async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const articleId = typeof body.article_id === 'string' ? body.article_id.trim() : '';
      const link = typeof body.link === 'string' ? body.link.trim() : '';
      if (!articleId || !link) {
        return reply.code(400).send({ error: 'article_id and link are required' });
      }

      await ingestService.enqueueFulltext({ articleId, link });
      reply.code(202).send({ accepted: true });
    })
  );

  return app;
}

export async function start() {
  const app = buildApp();
  await app.listen({ port: ENV.port, host: '0.0.0.0' });
}
