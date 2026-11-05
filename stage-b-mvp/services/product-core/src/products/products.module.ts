import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { HOT_STOCK, RedisHotStock } from './hot-stock';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [
    // without REDIS_URL everything runs on postgres alone
    { provide: HOT_STOCK, useFactory: () => (process.env.REDIS_URL ? new RedisHotStock(process.env.REDIS_URL) : null) },
    ProductsService,
  ],
  controllers: [ProductsController],
  exports: [ProductsService], // export so other modules can call pick etc
})
export class ProductsModule {}
