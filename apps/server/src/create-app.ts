import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { AppValidationPipe } from "./common/pipes/validation.pipe";

/**
 * Builds the production app assembly with every global applied, but never calls
 * `listen`. `main` calls this then listens; the boot smoke test calls it then
 * `app.init()`, so both exercise the exact same startup wiring.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>("nodeEnv", "development");

  if (nodeEnv === "development") {
    app.enableCors({
      origin: true,
      credentials: true,
    });
  }
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  return app;
}
