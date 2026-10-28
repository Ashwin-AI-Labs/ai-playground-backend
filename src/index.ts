import { createApp } from "./app";
import { env } from "./config/env";
import { closePool } from "./database/pool";

async function start() {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      `AI Playground API listening on port ${env.PORT} (${env.NODE_ENV})`,
    );
    console.log(
      "Ensure database migrations are applied before serving traffic (npm run db:migrate).",
    );
  });

  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log(`Received ${signal}. Shutting down gracefully...`);

    server.close(async (closeError) => {
      if (closeError) {
        console.error("Error while closing HTTP server:", closeError);
      }

      try {
        await closePool();
        console.log("PostgreSQL pool closed");
        process.exit(closeError ? 1 : 0);
      } catch (poolError) {
        console.error("Error while closing PostgreSQL pool:", poolError);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
