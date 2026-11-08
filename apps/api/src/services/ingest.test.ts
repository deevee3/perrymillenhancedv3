/// <reference types="jest" />

import { createIngestService } from './ingest';
import { schema } from '../db';

describe('IngestService', () => {
  it('creates feed/article once and enqueues job only on first insert', async () => {
    let articleInsertReturns = true;
    const jobInsertSpy = jest.fn();

    const fakeClient = {
      insert(table: unknown) {
        if (table === (schema.feeds as any)) {
          return {
            values() {
              return {
                onConflictDoUpdate() {
                  return {
                    async returning() {
                      return [{ id: 'feed-id' }];
                    }
                  };
                }
              };
            }
          };
        }
        if (table === (schema.articles as any)) {
          return {
            values() {
              return {
                onConflictDoNothing() {
                  return {
                    async returning() {
                      if (articleInsertReturns) {
                        articleInsertReturns = false;
                        return [{ id: 'article-id' }];
                      }
                      return [];
                    }
                  };
                }
              };
            }
          };
        }
        if (table === (schema.crawlJobs as any)) {
          return {
            values(data: unknown) {
              jobInsertSpy(data);
              return {
                onConflictDoNothing() {
                  return {};
                }
              };
            }
          };
        }
        throw new Error('unexpected table in fake client');
      }
    } as any;

    const service = createIngestService(fakeClient);

    const first = await service.ingestRss({
      feedUrl: 'http://example.com/feed',
      link: 'http://example.com/article',
      publishedAt: '2024-01-01T00:00:00Z'
    });
    expect(first.created).toBe(true);
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);

    const second = await service.ingestRss({
      feedUrl: 'http://example.com/feed',
      link: 'http://example.com/article'
    });
    expect(second.created).toBe(false);
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);
  });
});
