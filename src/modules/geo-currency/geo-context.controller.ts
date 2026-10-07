import { Controller, Get, Headers, Ip, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { GeoCurrencyService } from "./geo-currency.service";
import { GeoContextDto } from "./dto/geo-context.dto";
import { ApiEnvelopeOk } from "../../common/swagger/api-response.decorator";

/**
 * Separate controller at /v1/geo so that the existing /v1/fx/* routes on
 * GeoCurrencyController are not disturbed.
 */
@ApiTags("FX / Currency")
@Controller({ path: "geo", version: "1" })
export class GeoContextController {
  constructor(private readonly service: GeoCurrencyService) {}

  /**
   * Single-call endpoint consumed by the frontend CurrencyProvider on first
   * mount. Returns the visitor's detected country, suggested currency, all FX
   * rates, the enabled currencies list, and the FX buffer — everything the
   * CurrencyProvider needs in one round-trip.
   *
   * Country resolution priority:
   * 1. X-Geo-Country header (CDN-injected, never triggers an IP lookup)
   * 2. IP geolocation (ipapi.co or ipinfo.io per config)
   * 3. Default "NG" / "NGN" on localhost or any failure
   *
   * Raw IPs are never stored; only the country code is used.
   */
  @Get("context")
  @ApiOperation({
    summary: "Geo context + FX rates in one call",
    description:
      "Returns detected country, suggested currency, all live FX rates, " +
      "the admin-configured enabled currencies list, the FX buffer %, and " +
      "an optional `staleRates` flag when any rate is older than the " +
      "configured threshold.\n\n" +
      "Pass `X-Geo-Country: GB` to override detection (useful for testing).",
  })
  @ApiEnvelopeOk(GeoContextDto)
  getGeoContext(
    @Ip() ip: string,
    @Headers("x-geo-country") xGeoCountry?: string,
    @Headers("x-vercel-ip-country") vercelCountry?: string,
    @Headers("cf-ipcountry") cfCountry?: string,
    @Req() req?: Request,
  ): Promise<GeoContextDto> {
    // CDN / proxy country headers take precedence over IP lookup
    const cdnCountry = xGeoCountry ?? vercelCountry ?? cfCountry;

    // Resolve the real client IP: x-forwarded-for (set when trust proxy=1)
    // beats the socket address which may be the load-balancer's internal IP.
    const forwarded = req?.headers?.["x-forwarded-for"];
    const realIp =
      (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ??
      ip;

    return this.service.getGeoContext(realIp, cdnCountry);
  }
}
