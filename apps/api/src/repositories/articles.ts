import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';

export type ArticleRecord = typeof schema.articles.$inferSelect;

export interface BaseArticleFilters {
  feedId?: string;
  search?: string;
}

export interface ListArticlesParams extends BaseArticleFilters {
  limit: number;
  offset: number;
}

export interface ArticlesRepository {
  list(params: ListArticlesParams): Promise<ArticleRecord[]>;
  count(filters: BaseArticleFilters): Promise<number>;
  findById(id: string): Promise<ArticleRecord | null>;
}

export class DbArticlesRepository implements ArticlesRepository {
  constructor(private readonly client = db) {}

  async list(params: ListArticlesParams): Promise<ArticleRecord[]> {
    const where = this.buildWhere(params);
    if (where) {
      return await this.client
        .select()
        .from(schema.articles)
        .where(where)
        .orderBy(desc(schema.articles.publishedAt), desc(schema.articles.createdAt))
        .limit(params.limit)
        .offset(params.offset);
    }

    return await this.client
      .select()
      .from(schema.articles)
      .orderBy(desc(schema.articles.publishedAt), desc(schema.articles.createdAt))
      .limit(params.limit)
      .offset(params.offset);
  }

  async count(filters: BaseArticleFilters): Promise<number> {
    const where = this.buildWhere(filters);
    const countExpr = sql<number>`count(*)`.as('count');
    const query = where
      ? this.client.select({ count: countExpr }).from(schema.articles).where(where)
      : this.client.select({ count: countExpr }).from(schema.articles);

    const [row] = await query;
    return Number(row?.count ?? 0);
  }

  async findById(id: string): Promise<ArticleRecord | null> {
    const [article] = await this.client
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.id, id))
      .limit(1);
    return article ?? null;
  }

  private buildWhere(filters: BaseArticleFilters): SQL<unknown> | undefined {
    const clauses: SQL<unknown>[] = [];
    if (filters.feedId) {
      clauses.push(eq(schema.articles.feedId, filters.feedId));
    }
    if (filters.search) {
      clauses.push(ilike(schema.articles.title, `%${filters.search}%`));
    }
    if (clauses.length === 0) return undefined;
    if (clauses.length === 1) return clauses[0];
    return and(...clauses);
  }
}
