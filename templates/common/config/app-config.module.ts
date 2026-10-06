import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObjectSchema } from 'joi';
import { baseEnvSchema } from './base-env.schema.js';

@Global()
@Module({})
export class AppConfigModule {
  static forProject(extraSchema?: ObjectSchema): DynamicModule {
    const schema = extraSchema
      ? baseEnvSchema.concat(extraSchema)
      : baseEnvSchema;

    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: schema,
          validationOptions: {
            abortEarly: false,
            allowUnknown: true,
          },
        }),
      ],
    };
  }
}

