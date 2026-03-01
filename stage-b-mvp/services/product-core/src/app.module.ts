import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    // postgres connection — credentials come from env vars (or docker-compose environment block)
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'ase',
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'ase_products',
      autoLoadEntities: true,
      synchronize: true, // don't use this in production — use migrations instead
    }),
    ProductsModule,
  ],
})
export class AppModule {}
