import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  ServeStaticModule,
  type ServeStaticModuleOptions,
} from "@nestjs/serve-static";
import { CLIENT_DIST_PATH } from "./config/client-assets";
import { env } from "./config/env";
import { envFilePath } from "./config/env-file-path";
import { validationSchema } from "./config/validation";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { HealthModule } from "./modules/health/health.module";
import { ReviewModule } from "./modules/review/review.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
      load: [env],
      validationSchema,
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): ServeStaticModuleOptions[] =>
        configService.get<string>("nodeEnv") === "production"
          ? [{ rootPath: CLIENT_DIST_PATH, renderPath: "/" }]
          : [],
    }),
    HealthModule,
    DashboardModule,
    ReviewModule,
  ],
})
export class AppModule {}
