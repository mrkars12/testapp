import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EncryptionService } from './encryption.service'
import { EnvKeyProvider } from './env-key.provider'
import { KEY_PROVIDER } from './key-provider.interface'
import { StoreKeyService } from './store-key.service'

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KEY_PROVIDER,
      useClass: EnvKeyProvider,
    },
    EncryptionService,
    StoreKeyService,
  ],
  exports: [KEY_PROVIDER, EncryptionService, StoreKeyService],
})
export class CryptoModule {}
