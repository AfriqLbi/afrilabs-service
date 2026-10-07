/**
 * Normalizes country names and codes to ISO 3166-1 alpha-2.
 *
 * The shipping address stored on orders may contain full country names
 * ("Nigeria", "United Kingdom") while shipping zones are configured with
 * ISO alpha-2 codes ("NG", "GB").  This utility bridges the gap so zone
 * matching works regardless of what the client sends.
 */

const COUNTRY_MAP: Record<string, string> = {
  // Common full names
  nigeria: "NG",
  ghana: "GH",
  "united kingdom": "GB",
  britain: "GB",
  england: "GB",
  canada: "CA",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  usa: "US",
  germany: "DE",
  france: "FR",
  italy: "IT",
  spain: "ES",
  "south africa": "ZA",
  kenya: "KE",
  india: "IN",
  china: "CN",
  japan: "JP",
  australia: "AU",
  netherlands: "NL",
  belgium: "BE",
  ireland: "IE",
  "united arab emirates": "AE",
  uae: "AE",
  dubai: "AE",
};

/**
 * Returns the ISO 3166-1 alpha-2 code for the given country string.
 * If the input is already a 2-letter code it is returned uppercased as-is.
 * Unknown inputs are returned uppercased so zone matching can still attempt
 * a direct comparison (the zone may store the full name).
 */
export function toIsoAlpha2(country: string | undefined | null): string {
  if (!country) return "";
  const trimmed = country.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return COUNTRY_MAP[lower] ?? trimmed.toUpperCase();
}
