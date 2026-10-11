import { b64Encode, safeEqual, utf8, type Bytes } from './bytes'

// X proves a delivery is genuine by signing the raw body with the app's
// OAuth 2.0 client secret, and proves we own the URL by asking us to sign a
// challenge with the same key.

export async function hmacSha256(key: string, message: Bytes): Promise<string> {
  const k = await crypto.subtle.importKey('raw', utf8(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return 'sha256=' + b64Encode(await crypto.subtle.sign('HMAC', k, message))
}

export const crcResponse = async (clientSecret: string, crcToken: string) => ({
  response_token: await hmacSha256(clientSecret, utf8(crcToken)),
})

export async function verifySignature(
  rawBody: Bytes,
  headers: Headers,
  clientSecret: string,
  consumerSecret?: string,
): Promise<boolean> {
  const modern = headers.get('X-Twitter-Webhooks-Signature-OAuth2')
  if (modern !== null) return safeEqual(modern, await hmacSha256(clientSecret, rawBody))
  const legacy = headers.get('X-Twitter-Webhooks-Signature')
  if (legacy !== null && consumerSecret) return safeEqual(legacy, await hmacSha256(consumerSecret, rawBody))
  return false
}
