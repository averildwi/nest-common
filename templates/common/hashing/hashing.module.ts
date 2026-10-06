import { Global, Module } from '@nestjs/common';
import { HashingService } from './hashing.service.js';

@Global()
@Module({
  providers: [HashingService],
  exports: [HashingService],
})
export class HashingModule {}

