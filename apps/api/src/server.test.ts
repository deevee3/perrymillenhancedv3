/// <reference types="jest" />

process.env.NODE_ENV = 'test';
process.env.SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? 'local-dev-service-key';

import { build } from './testApp';
import type { ArticleRecord, ArticlesRepository } from './repositories/articles';
import type { IngestService } from './services/ingest';

function makeArticle(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  const now = new Date();
  return {
    id: 'article-id',
    feedId: null,
    guid: null,
    title: 'Sample Article',
    summary: null,
    link: 'http://example.com/article',
    canonicalUrl: null,
    author: null,
    publishedAt: now,
    rawHtml: null,
    text: null,
    images: [],
    language: null,
    wordCount: null,
    linkHash: 'hash',
    status: 'new',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('server', () => {
  it('returns health', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('requires auth for articles', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/v1/articles' });
    expect(res.statusCode).toBe(401);
  });

  it('lists articles with pagination', async () => {
    const fakeRepo: ArticlesRepository = {
      async list() {
        return [makeArticle({ id: 'a1', feedId: 'f1', linkHash: 'hash1' })];
      },
      async count() {
        return 42;
      },
      async findById() {
        return null;
      }
    };

    const app = await build({ articlesRepo: fakeRepo });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/articles?page=2&pageSize=10',
      headers: { authorization: 'Bearer token' }
    } as any);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(10);
    expect(body.total).toBe(42);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('a1');
  });

  it('returns article by id', async () => {
    const article = makeArticle({ id: 'a1', feedId: 'f1', link: 'http://example.com/1', linkHash: 'hash1' });
    const fakeRepo: ArticlesRepository = {
      async list() {
        return [];
      },
      async count() {
        return 0;
      },
      async findById(id) {
        return id === 'a1' ? article : null;
      }
    };

    const app = await build({ articlesRepo: fakeRepo });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/articles/a1',
      headers: { authorization: 'Bearer token' }
    } as any);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('a1');
  });

  it('returns 404 when article missing', async () => {
    const fakeRepo: ArticlesRepository = {
      async list() {
        return [];
      },
      async count() {
        return 0;
      },
      async findById() {
        return null;
      }
    };
    const app = await build({ articlesRepo: fakeRepo });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/articles/missing',
      headers: { authorization: 'Bearer token' }
    } as any);
    expect(res.statusCode).toBe(404);
  });

  it('ingests rss item and enqueues crawl job', async () => {
    const ingestMock: IngestService = {
      async ingestRss() {
        return { created: true };
      },
      async enqueueFulltext() {}
    };

    const app = await build({ ingestService: ingestMock });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/rss',
      headers: { 'x-service-key': process.env.SERVICE_API_KEY! },
      payload: {
        feed_url: 'http://example.com/feed',
        link: 'http://example.com/article'
      }
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true, created: true });
  });

  it('rejects rss ingest without required fields', async () => {
    const ingestMock: IngestService = {
      async ingestRss() {
        return { created: false };
      },
      async enqueueFulltext() {}
    };

    const app = await build({ ingestService: ingestMock });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/rss',
      headers: { 'x-service-key': process.env.SERVICE_API_KEY! },
      payload: {
        feed_url: '',
        link: ''
      }
    });

    expect(res.statusCode).toBe(400);
  });

  it('enqueues fulltext job', async () => {
    const enqueueSpy = jest.fn();
    const ingestMock: IngestService = {
      async ingestRss() {
        return { created: false };
      },
      async enqueueFulltext(params) {
        enqueueSpy(params);
      }
    };

    const app = await build({ ingestService: ingestMock });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/fulltext',
      headers: { 'x-service-key': process.env.SERVICE_API_KEY! },
      payload: {
        article_id: 'a1',
        link: 'http://example.com/article'
      }
    });

    expect(res.statusCode).toBe(202);
    expect(enqueueSpy).toHaveBeenCalledWith({ articleId: 'a1', link: 'http://example.com/article' });
  });

  it('validates fulltext payload', async () => {
    const ingestMock: IngestService = {
      async ingestRss() {
        return { created: false };
      },
      async enqueueFulltext() {}
    };

    const app = await build({ ingestService: ingestMock });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ingest/fulltext',
      headers: { 'x-service-key': process.env.SERVICE_API_KEY! },
      payload: {
        article_id: '',
        link: ''
      }
    });

    expect(res.statusCode).toBe(400);
  });
});
