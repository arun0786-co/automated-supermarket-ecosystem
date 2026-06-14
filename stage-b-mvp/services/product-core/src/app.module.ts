import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { dbOptions } from './db/config';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dbOptions,
      autoLoadEntities: true,
      synchronize: true, // fine for the MVP, switch to migrations before real data
    }),
    ProductsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
