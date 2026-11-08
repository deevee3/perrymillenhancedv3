Assumptions and chosen stack
- API: Node.js + Fastify (TypeScript), Drizzle ORM (Postgres/Supabase), Zod for validation, jose for JWT.
- Auth: Supabase Auth (JWT) for user endpoints; x-service-key header for internal ingest endpoints.
- DB: Supabase Postgres (local: Docker Postgres).
- Workers:
  - Python RSS worker using feedparser -> POST to API.
  - Node full-text worker: Readability first, Puppeteer fallback.
- Queue: Start with DB-backed crawl_jobs table (simple, reliable). You can add Redis later.
- Testing: Jest (API), Pytest (Python RSS worker), lightweight integration tests with fastify.inject.

Order of operations (iterations with tests)
- Iteration 0: Repo + DB + OpenAPI + healthcheck.
  - Deliverables: Monorepo scaffold, docker-compose with Postgres, initial Drizzle schema, API /v1/health.
  - Tests: API health test passes. DB connects and migrations run.
  - Acceptance: CI passes green.
- Iteration 1: Articles read API + UI integration stub.
  - Deliverables: GET /v1/articles and GET /v1/articles/{id} wired to DB with seed script.
  - Tests: Unit tests for both endpoints; pagination and sorting.
  - Acceptance: UI (or curl) shows seeded articles.
- Iteration 2: Auth + Saves.
  - Deliverables: Supabase JWT verification; POST/DELETE /v1/articles/{id}/save; RLS-friendly schema.
  - Tests: Auth middleware test (valid/invalid token); save/unsave flow.
  - Acceptance: Save shows in user’s list via DB query.
- Iteration 3: RSS ingestion pipeline.
  - Deliverables: Python worker posts to /v1/ingest/rss; API upserts feeds+articles, enqueues crawl job.
  - Tests: API ingest dedup; Python worker unit test for entry parsing.
  - Acceptance: New feed items appear via GET /articles.
- Iteration 4: Full-text extraction.
  - Deliverables: Node worker processes crawl_jobs; Readability first, Puppeteer fallback; update article.text.
  - Tests: Extraction unit test with static HTML; job state transitions.
  - Acceptance: Article full text visible via GET /articles/{id}.
- Iteration 5: Share links.
  - Deliverables: POST /v1/articles/{id}/share -> signed token row; GET /v1/s/{token} public view.
  - Tests: Share token creation, expiry handling.
  - Acceptance: Public URL renders article text without auth.
- Iteration 6: Prod hardening.
  - Deliverables: Rate limit, logging, domain throttling, robots.txt respect toggle.
  - Tests: Rate limit unit; domain backoff logic.

To prevent LLM loops during execution, adopt the “one sub-task at a time” and completion protocol (tests → commit) [3]. Maintain a concise “Relevant Files” section as you go [2]. If you later want a formal PRD, start with clarifying questions first [1].

Repo structure (monorepo)
- /apps/api — Fastify API (TypeScript)
- /apps/worker-extract — Node full-text worker (TypeScript)
- /apps/worker-rss — Python RSS worker
- /packages/db — Drizzle schema + migrations
- /packages/shared — shared types (OpenAPI-generated types optional)
- /docker — docker-compose for Postgres
- /tests — e2e/integration harness (optional)

.env keys (root)
- DATABASE_URL=postgres://postgres:postgres@localhost:5432/news
- SUPABASE_JWKS_URL=https://<project-id>.supabase.co/auth/v1/keys
- SERVICE_API_KEY=local-dev-service-key
- PUPPETEER_EXECUTABLE_PATH= (optional on Linux)
- NODE_ENV=development

OpenAPI spec (openapi.yaml)
- Save at /apps/api/openapi.yaml

openapi: 3.0.3
info:
  title: Perry Mill
  version: 1.0.0
servers:
  - url: /v1
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    serviceKey:
      type: apiKey
      in: header
      name: x-service-key
  schemas:
    Feed:
      type: object
      properties:
        id: { type: string, format: uuid }
        url: { type: string }
        title: { type: string, nullable: true }
        site_url: { type: string, nullable: true }
        last_fetched_at: { type: string, format: date-time, nullable: true }
        status: { type: string, enum: [active, error] }
    Article:
      type: object
      properties:
        id: { type: string, format: uuid }
        feed_id: { type: string, format: uuid, nullable: true }
        guid: { type: string, nullable: true }
        title: { type: string, nullable: true }
        summary: { type: string, nullable: true }
        link: { type: string }
        canonical_url: { type: string, nullable: true }
        author: { type: string, nullable: true }
        published_at: { type: string, format: date-time, nullable: true }
        text: { type: string, nullable: true }
        images:
          type: array
          items: { type: string }
        language: { type: string, nullable: true }
        word_count: { type: integer, nullable: true }
        status: { type: string, enum: [new, queued, processed, failed] }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    PaginatedArticles:
      type: object
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/Article' }
        page: { type: integer }
        pageSize: { type: integer }
        total: { type: integer }
paths:
  /health:
    get:
      summary: Health check
      responses:
        '200': { description: OK }
  /articles:
    get:
      summary: List articles
      security: [{ bearerAuth: [] }]
      parameters:
        - in: query
          name: feedId
          schema: { type: string, format: uuid }
        - in: query
          name: q
          schema: { type: string }
        - in: query
          name: page
          schema: { type: integer, default: 1, minimum: 1 }
        - in: query
          name: pageSize
          schema: { type: integer, default: 20, maximum: 100 }
      responses:
        '200':
          description: Paginated list
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PaginatedArticles' }
  /articles/{id}:
    get:
      summary: Get article by id
      security: [{ bearerAuth: [] }]
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Article
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Article' }
        '404': { description: Not found }
  /articles/{id}/save:
    post:
      summary: Save article
      security: [{ bearerAuth: [] }]
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        '204': { description: Saved }
    delete:
      summary: Unsave article
      security: [{ bearerAuth: [] }]
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        '204': { description: Removed }
  /articles/{id}/share:
    post:
      summary: Create share link
      security: [{ bearerAuth: [] }]
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      responses:
        '200':
          description: Share token
          content:
            application/json:
              schema:
                type: object
                properties:
                  url: { type: string }
  /s/{token}:
    get:
      summary: Public share page
      parameters:
        - in: path
          name: token
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Article content
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Article' }
        '404': { description: Not found }
  /feeds:
    get:
      summary: List feeds
      security: [{ bearerAuth: [] }]
      responses:
        '200':
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Feed' }
    post:
      summary: Add feed
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url]
              properties:
                url: { type: string }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Feed' }
  /ingest/rss:
    post:
      summary: Ingest RSS item (internal)
      security: [{ serviceKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [feed_url, title, link]
              properties:
                feed_url: { type: string }
                guid: { type: string }
                title: { type: string }
                summary: { type: string }
                link: { type: string }
                published_at: { type: string, format: date-time }
      responses:
        '202': { description: Accepted }
  /ingest/fulltext:
    post:
      summary: Enqueue full-text crawl (internal)
      security: [{ serviceKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [article_id, link]
              properties:
                article_id: { type: string, format: uuid }
                link: { type: string }
      responses:
        '202': { description: Enqueued }

Drizzle schema (packages/db/schema.ts)
import { pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const articleStatus = pgEnum('article_status', ['new','queued','processed','failed']);
export const feedStatus = pgEnum('feed_status', ['active','error']);

export const feeds = pgTable('feeds', {
  id: uuid('id').defaultRandom().primaryKey(),
  url: text('url').notNull().unique(),
  title: text('title'),
  siteUrl: text('site_url'),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  status: feedStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const articles = pgTable('articles', {
  id: uuid('id').defaultRandom().primaryKey(),
  feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'set null' }),
  guid: text('guid'),
  title: text('title'),
  summary: text('summary'),
  link: text('link').notNull(),
  canonicalUrl: text('canonical_url'),
  author: text('author'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  rawHtml: text('raw_html'),
  text: text('text'),
  images: jsonb('images').$type<string[]>().default([]),
  language: text('language'),
  wordCount: integer('word_count'),
  linkHash: text('link_hash').notNull(),
  status: articleStatus('status').notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    linkHashIdx: uniqueIndex('articles_link_hash_uniq').on(table.linkHash),
    publishedIdx: index('articles_published_idx').on(table.publishedAt),
  };
});

export const articleSaves = pgTable('article_saves', {
  userId: uuid('user_id').notNull(),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.articleId] })
}));

export const shares = pgTable('shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  tokenIdx: uniqueIndex('shares_token_uniq').on(t.token)
}));

export const crawlJobs = pgTable('crawl_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  articleId: uuid('article_id').references(() => articles.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  status: text('status').notNull().default('queued'), // queued, running, done, failed
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  statusIdx: index('crawl_jobs_status_idx').on(t.status, t.updatedAt)
}));

Drizzle config and migration scripts
- packages/db/drizzle.config.ts
import type { Config } from 'drizzle-kit';
export default {
  schema: './schema.ts',
  out: './migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config;

- package.json (root) add scripts:
  - "db:generate": "drizzle-kit generate --config packages/db/drizzle.config.ts"
  - "db:migrate": "drizzle-kit migrate --config packages/db/drizzle.config.ts"
  - "db:push": "drizzle-kit push --config packages/db/drizzle.config.ts"

API boilerplate (apps/api/src)
- src/env.ts
import 'dotenv/config';
export const ENV = {
  port: Number(process.env.PORT || 3000),
  dbUrl: process.env.DATABASE_URL!,
  jwksUrl: process.env.SUPABASE_JWKS_URL!,
  serviceKey: process.env.SERVICE_API_KEY!,
};

- src/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../../packages/db/schema';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export { schema };

- src/auth.ts
import { createLocalJWKSet, jwtVerify } from 'jose';
import { ENV } from './env';
const jwksCache: { jwks?: ReturnType<typeof createLocalJWKSet> } = {};
export async function verifyJWT(token: string) {
  if (!jwksCache.jwks) {
    const res = await fetch(ENV.jwksUrl);
    const jwks = await res.json();
    jwksCache.jwks = createLocalJWKSet(jwks);
  }
  const { payload } = await jwtVerify(token, jwksCache.jwks!, { issuer: undefined, audience: undefined });
  return payload;
}
export function requireAuth(fn: (ctx: { userId: string }) => Promise<any>) {
  return async (req: any, reply: any) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      const payload = await verifyJWT(token);
      // Supabase JWT has sub as user id
      return fn({ userId: String(payload.sub) });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}
export function requireServiceKey(fn: (req: any, reply: any) => Promise<any>) {
  return async (req: any, reply: any) => {
    if (req.headers['x-service-key'] !== ENV.serviceKey) return reply.code(401).send({ error: 'Unauthorized' });
    return fn(req, reply);
  };
}

- src/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db, schema } from './db';
import { requireAuth, requireServiceKey } from './auth';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const app = Fastify({ logger: true });
app.register(cors, { origin: true });

app.get('/v1/health', async () => ({ ok: true }));

app.get('/v1/articles', requireAuth(async ({ userId }) => {
  // Pagination params via querystring
  // Fastify inject doesn’t pass directly here, so use onRequest alternative in real routes
  return { items: [], page: 1, pageSize: 20, total: 0 };
}));

app.get('/v1/articles/:id', requireAuth(async () => {
  return {};
}));

app.post('/v1/articles/:id/save', requireAuth(async ({ userId }) => {
  return {};
}));

app.delete('/v1/articles/:id/save', requireAuth(async ({ userId }) => {
  return {};
}));

app.get('/v1/feeds', requireAuth(async () => {
  return [];
}));

app.post('/v1/feeds', requireAuth(async () => {
  return {};
}));

app.post('/v1/ingest/rss', requireServiceKey(async (req: any, reply: any) => {
  // upsert feed, upsert article, enqueue crawl job
  reply.code(202).send({ accepted: true });
}));

app.post('/v1/ingest/fulltext', requireServiceKey(async (req: any, reply: any) => {
  // enqueue crawl job
  reply.code(202).send({ accepted: true });
}));

export async function start() {
  await app.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' });
}
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });

Notes:
- The route bodies above are placeholders; below are the concrete implementations you’ll wire in Iterations 1–4.

API route implementations (key snippets)
- GET /v1/articles with search/pagination
// inside the handler body
const q = (app as any).request?.query?.q || '';
const page = Number((app as any).request?.query?.page ?? 1);
const pageSize = Math.min(Number((app as any).request?.query?.pageSize ?? 20), 100);
const where = q ? ilike(schema.articles.title, `%${q}%`) : undefined;
const [items, [{ count }]] = await Promise.all([
  db.select().from(schema.articles)
    .where(where as any)
    .orderBy(desc(schema.articles.publishedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize),
  db.select({ count: db.sql<number>`count(*)` }).from(schema.articles).where(where as any)
]);
return { items, page, pageSize, total: Number(count) };

- GET /v1/articles/:id
const { id } = (app as any).request.params as { id: string };
const [article] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
if (!article) return reply.code(404).send({ error: 'Not found' });
return article;

- POST /v1/articles/:id/save
const { id } = (app as any).request.params as { id: string };
await db.insert(schema.articleSaves).values({ userId, articleId: id }).onConflictDoNothing();
return (app as any).reply.code(204).send();

- DELETE /v1/articles/:id/save
const { id } = (app as any).request.params as { id: string };
await db.delete(schema.articleSaves).where(and(eq(schema.articleSaves.userId, userId), eq(schema.articleSaves.articleId, id)));
return (app as any).reply.code(204).send();

- POST /v1/feeds
const { url } = (app as any).request.body as { url: string };
const [feed] = await db.insert(schema.feeds).values({ url }).onConflictDoNothing().returning();
return (app as any).reply.code(201).send(feed);

- POST /v1/ingest/rss (internal)
const body = (app as any).request.body as { feed_url: string; guid?: string; title?: string; summary?: string; link: string; published_at?: string; };
const linkHash = createHash('sha256').update(normalizeUrl(body.link)).digest('hex');
const [feed] = await db.insert(schema.feeds).values({ url: body.feed_url }).onConflictDoUpdate({ target: schema.feeds.url, set: { updatedAt: new Date() } }).returning();
const [article] = await db.insert(schema.articles).values({
  feedId: feed.id, guid: body.guid || null, title: body.title || null, summary: body.summary || null,
  link: body.link, linkHash, publishedAt: body.published_at ? new Date(body.published_at) : null, status: 'queued'
}).onConflictDoNothing().returning();
if (article) {
  await db.insert(schema.crawlJobs).values({ articleId: article.id, url: body.link, status: 'queued' });
}
return (app as any).reply.code(202).send({ ok: true });

- POST /v1/articles/{id}/share
const token = randomUUID().replace(/-/g, '');
await db.insert(schema.shares).values({ articleId: id, userId, token });
return { url: `${(app as any).request.protocol}://${(app as any).request.hostname}/v1/s/${token}` };

- GET /v1/s/:token
const { token } = (app as any).request.params as { token: string };
const [share] = await db.select().from(schema.shares).where(eq(schema.shares.token, token));
if (!share) return reply.code(404).send({ error: 'Not found' });
const [article] = await db.select().from(schema.articles).where(eq(schema.articles.id, share.articleId));
if (!article) return reply.code(404).send({ error: 'Not found' });
return article;

Python RSS worker (apps/worker-rss/main.py)
import os
import time
import feedparser
import requests

API_BASE = os.getenv("API_BASE", "http://localhost:3000/v1")
SERVICE_KEY = os.getenv("SERVICE_API_KEY", "local-dev-service-key")
FEED_URLS = os.getenv("FEED_URLS", "").split(",")  # comma-separated list

def post_item(feed_url, entry):
    payload = {
        "feed_url": feed_url,
        "guid": entry.get("id"),
        "title": entry.get("title"),
        "summary": entry.get("summary"),
        "link": entry.get("link"),
        "published_at": entry.get("published"),
    }
    r = requests.post(f"{API_BASE}/ingest/rss", json=payload, headers={"x-service-key": SERVICE_KEY}, timeout=15)
    r.raise_for_status()

def run_once():
    for feed_url in FEED_URLS:
        if not feed_url: continue
        d = feedparser.parse(feed_url)
        for e in d.entries:
            post_item(feed_url, e)

if __name__ == "__main__":
    run_once()

Node full-text worker (apps/worker-extract/src/index.ts)
import 'dotenv/config';
import { db, schema } from '../../../packages/db/schema-conn'; // export a db connection similar to API
import { eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'NewsBot/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function extractWithReadability(html: string, url: string) {
  const doc = new JSDOM(html, { url });
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  if (!article) return { text: '', title: '', length: 0 };
  return { text: article.textContent || '', title: article.title || '', length: (article.textContent || '').length };
}

async function fetchWithPuppeteer(url: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const html = await page.content();
  await browser.close();
  return html;
}

async function processOne() {
  const [job] = await db.query.crawlJobs.findMany({ where: (t, { eq }) => eq(t.status, 'queued'), limit: 1 });
  if (!job) return false;
  await db.update(schema.crawlJobs).set({ status: 'running', attempts: job.attempts + 1 }).where(eq(schema.crawlJobs.id, job.id));
  try {
    let html = await fetchHtml(job.url);
    let { text, length } = extractWithReadability(html, job.url);
    if (length < 500) {
      html = await fetchWithPuppeteer(job.url);
      ({ text, length } = extractWithReadability(html, job.url));
    }
    await db.update(schema.articles).set({ text, rawHtml: null, status: 'processed', wordCount: Math.round(length / 5) }).where(eq(schema.articles.id, job.articleId));
    await db.update(schema.crawlJobs).set({ status: 'done' }).where(eq(schema.crawlJobs.id, job.id));
  } catch (e: any) {
    await db.update(schema.crawlJobs).set({ status: 'failed', lastError: e.message }).where(eq(schema.crawlJobs.id, job.id));
  }
  return true;
}

async function main() {
  while (true) {
    const did = await processOne();
    if (!did) await new Promise(r => setTimeout(r, 2000));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

Tests (Iteration by iteration)
- Setup: add Jest to apps/api
apps/api/jest.config.ts
import type { Config } from 'jest';
const config: Config = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testMatch: ['**/?(*.)+(spec|test).ts'],
};
export default config;

- Unit: health and articles list
apps/api/src/server.test.ts
import { build } from './testApp';

test('health', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/v1/health' });
  expect(res.statusCode).toBe(200);
});

test('articles requires auth', async () => {
  const app = await build();
  const res = await app.inject({ method: 'GET', url: '/v1/articles' });
  expect(res.statusCode).toBe(401);
});

- Test app builder (no network, fast)
apps/api/src/testApp.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { requireAuth, requireServiceKey } from './auth';
import { db, schema } from './db';
export async function build() {
  const app = Fastify();
  app.register(cors);
  app.get('/v1/health', async () => ({ ok: true }));
  // You can register minimal routes to test logic in isolation
  return app;
}

- Ingestion dedup test (Iteration 3)
apps/api/src/ingest.test.ts
import { build } from './testApp';
// mock db insert and ensure onConflictDoNothing works for same linkHash

- Python tests (apps/worker-rss/tests/test_parse.py)
from worker_rss.main import post_item
def test_payload_shape(monkeypatch):
    class Resp: 
        status_code=202
        def raise_for_status(self): pass
    called = {}
    def fake_post(url, json=None, headers=None, timeout=None):
        called['json']=json; return Resp()
    import worker_rss.main as m
    monkeypatch.setattr(m.requests, 'post', fake_post)
    post_item('http://example.com/feed', {'id':'g1','title':'t','summary':'s','link':'http://x','published':'2020-01-01'})
    assert 'feed_url' in called['json'] and 'link' in called['json']

Commands and CI scripts
- Root package.json scripts:
  - "dev:api": "pnpm --filter @app/api dev"
  - "dev:worker:extract": "pnpm --filter @app/worker-extract dev"
  - "dev:worker:rss": "python apps/worker-rss/main.py"
  - "test:api": "pnpm --filter @app/api test"
  - "test:rss": "pytest apps/worker-rss"
  - "db:generate" / "db:migrate" as above

docker/docker-compose.yml
version: '3.9'
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
      POSTGRES_DB: news
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
volumes:
  pgdata:

Notes on auth and RLS
- Supabase Auth: API verifies JWT via JWKS URL; for data access, you can keep RLS logic primarily in API (server-side). If you enable RLS on article_saves, ensure API uses a service role or implements operations consistent with policies.
- Keep LLM out of ingestion path. Summaries can be an offline field stored separately to avoid “hallucinations” impacting core flows.

“Relevant Files” tracker and task protocol
- Maintain a tasks file with:
  - Relevant Files (paths + purpose)
  - Tasks and Subtasks with checkboxes
  - Execute one sub-task at a time and commit only after tests pass [3].
- If you want a formal task list scaffold with the “Relevant Files” section format, follow the example structure from the task generator reference [2].

Next steps (actionable)
1) Clone scaffold and run docker-compose up -d; set DATABASE_URL; run db:migrate.
2) Implement Iteration 1 routes using the Drizzle snippets; add Jest tests; run test:api.
3) Wire Supabase JWKS and test Iteration 2 auth + saves.
4) Run Python worker once with a known feed; verify items appear; then process full-text with the Node worker.

If you want, I can generate a ready-to-run repository zip or GitHub template with this structure and fill in the missing route bodies and tests for Iteration 1–3. Also, tell me:
- Your Supabase project URL (for JWKS).
- Preferred package manager (pnpm/yarn/npm).
- OS environment (for Puppeteer configuration).

Citations used for process guidance:
- Use one sub-task at a time with completion protocol to prevent loops [3].
- Maintain a “Relevant Files” section and task list format to keep progress deterministic [2].
- If we later author a PRD, start with clarifying questions first [1].