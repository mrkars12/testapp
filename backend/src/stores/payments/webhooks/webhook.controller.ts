import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common'
import type { Request } from 'express'
import { WebhookIngestionService } from './webhook-ingestion.service'

/**
 * Provider callbacks.
 *
 * Public and unauthenticated by necessity: providers cannot hold a
 * session. The HMAC signature is the security boundary, which is why the
 * account id in the path being guessable is not a weakness — an attacker
 * who knows it still cannot forge a signed body.
 *
 * Always 200 once the request has been handled, whatever the outcome.
 * Returning 4xx or 5xx makes providers retry and eventually disable the
 * endpoint, and a disabled endpoint is far more damaging than an
 * individual event we chose not to act on.
 */
@Controller('payments/webhooks')
export class WebhookController {
  constructor(private readonly ingestion: WebhookIngestionService) {}

  @Post(':gateway/:accountId')
  @HttpCode(200)
  async receive(
    @Param('gateway') gateway: string,
    @Param('accountId') accountId: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const result = await this.ingestion.ingest({
      accountId,
      rawBody: request.rawBody,
      headers: request.headers as Record<string, string | string[] | undefined>,
    })

    return {
      received: true,
      gateway,
      outcome: result.outcome,
      facts: result.factCount,
    }
  }
}
