import { createHash } from 'crypto';
import { db, schema } from '../db';
import { normalizeUrl } from '../util/normalizeUrl';
import { parseNullableDate } from '../util/date';
type DbClient = typeof db;

export interface IngestRssParams {
  feedUrl: string;
  guid?: string;
  title?: string;
  summary?: string;
  link: string;
  publishedAt?: string;
}

export interface IngestService {
  ingestRss(params: IngestRssParams): Promise<{ created: boolean }>;
  enqueueFulltext(params: { articleId: string; link: string }): Promise<void>;
}

export function createIngestService(client: DbClient = db): IngestService {
  const feedsTable = schema.feeds as any;
  const articlesTable = schema.articles as any;
  const crawlJobsTable = schema.crawlJobs as any;

  return {
    async ingestRss(params) {
      const normalizedLink = normalizeUrl(params.link);
      const linkHash = createHash('sha256').update(normalizedLink).digest('hex');

      const feedResult = await client
        .insert(feedsTable)
        .values({ url: params.feedUrl })
        .onConflictDoUpdate({
          target: feedsTable.url,
          set: { updatedAt: new Date() }
        })
        .returning();
      const feed = (feedResult as any)[0];

      const articleResult = await client
        .insert(articlesTable)
        .values({
          feedId: feed.id,
          guid: params.guid ?? null,
          title: params.title ?? null,
          summary: params.summary ?? null,
          link: normalizedLink,
          canonicalUrl: null,
          author: null,
          publishedAt: parseNullableDate(params.publishedAt),
          rawHtml: null,
          text: null,
          images: [],
          language: null,
          wordCount: null,
          linkHash,
          status: 'queued'
        })
        .onConflictDoNothing()
        .returning();
      const article = (articleResult as any)[0];

      if (article) {
        await client
          .insert(crawlJobsTable)
          .values({ articleId: article.id, url: normalizedLink, status: 'queued' })
          .onConflictDoNothing();
        return { created: true };
      }

      return { created: false };
    },

    async enqueueFulltext(params) {
      await client
        .insert(crawlJobsTable)
        .values({ articleId: params.articleId, url: params.link, status: 'queued' })
        .onConflictDoNothing();
    }
  };
}
