import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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
    HealthModule,
    DashboardModule,
    ReviewModule,
  ],
})
export class AppModule {}
