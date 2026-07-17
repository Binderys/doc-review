import { ConfigService } from "@nestjs/config";
import { createApp } from "./create-app";

async function bootstrap() {
  const app = await createApp();
  const configService = app.get(ConfigService);
  const host = configService.get<string>("host", "127.0.0.1");
  const port = configService.get<number>("port", 3000);

  await app.listen(port, host);
  if (process.send) {
    const listeningUrl = new URL(await app.getUrl());
    process.send({ type: "ready", port: Number(listeningUrl.port) });
  }
}

void bootstrap();
