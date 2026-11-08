import 'dotenv/config';

export const ENV = {
  port: Number(process.env.PORT || 3333),
  dbUrl: process.env.DATABASE_URL!,
  jwksUrl: process.env.SUPABASE_JWKS_URL!,
  serviceKey: process.env.SERVICE_API_KEY!
};
