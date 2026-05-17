import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// stage B product-core service — Service A from the spec
// this replaces the flat PRODUCTS array in the stage A simulator with a real postgres-backed API
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`product-core running on port ${port}`);
}

bootstrap();
