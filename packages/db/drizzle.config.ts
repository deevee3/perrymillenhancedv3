import type { Config } from 'drizzle-kit';

const config: Config = {
  schema: './schema.ts',
  out: './migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!
  }
};

export default config;
