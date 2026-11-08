import { buildApp, type AppDependencies } from './server';

export async function build(deps: AppDependencies = {}) {
  const app = buildApp({ logger: false }, deps);
  return app;
}
