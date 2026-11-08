import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const articleStatus = pgEnum('article_status', ['new', 'queued', 'processed', 'failed']);
export const feedStatus = pgEnum('feed_status', ['active', 'error']);

export const feeds = pgTable('feeds', {
  id: uuid('id').defaultRandom().primaryKey(),
  url: text('url').notNull().unique(),
  title: text('title'),
  siteUrl: text('site_url'),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  status: feedStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const articles = pgTable(
  'articles',
  {
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
  },
  (table) => ({
    linkHashIdx: uniqueIndex('articles_link_hash_uniq').on(table.linkHash),
    publishedIdx: index('articles_published_idx').on(table.publishedAt)
  })
);

export const articleSaves = pgTable(
  'article_saves',
  {
    userId: uuid('user_id').notNull(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.articleId] })
  })
);

export const shares = pgTable(
  'shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id').notNull(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
  },
  (t) => ({
    tokenIdx: uniqueIndex('shares_token_uniq').on(t.token)
  })
);

export const crawlJobs = pgTable(
  'crawl_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    url: text('url').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
  },
  (t) => ({
    statusIdx: index('crawl_jobs_status_idx').on(t.status, t.updatedAt)
  })
);
