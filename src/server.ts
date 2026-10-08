import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const config = loadConfig();
const app = await buildApp(config);

const shutdown = (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (error: unknown) => {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    },
  );
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { provider: config.llm.provider, model: app.container.provider.model },
    'ai-support-service ready',
  );
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
