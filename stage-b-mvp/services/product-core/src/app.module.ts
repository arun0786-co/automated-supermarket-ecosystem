import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { dbOptions } from './db/config';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...dbOptions,
      autoLoadEntities: true,
      synchronize: true, // fine for the MVP, switch to migrations before real data
    }),
    ProductsModule,
  ],
})
export class AppModule {}
