// Copies the signed feeds from Vercel into files this repository serves.
//
// Some Vercel addresses do not answer from Russia, and which address a
// vercel.app name resolves to changes over time. GitHub's raw host and jsDelivr
// do answer, so the clients ask those as well. Runners are outside Russia, so
// Vercel is reachable from here.
//
// Nothing is re-signed. Each envelope is copied exactly as served, after
// checking its signature against the key compiled into the clients - a broken
// or tampered origin is not published, and the previous copy stays.
import { createPublicKey, verify } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const keyFromHex = (hex) => createPublicKey({
  key: Buffer.from('302a300506032b6570032100' + hex, 'hex'),
  format: 'der',
  type: 'spki',
})

const FEEDS = [
  {
    file: 'proxies.json',
    url: 'https://tg-proxy-feed.vercel.app/api/proxies',
    key: keyFromHex('24a284bf58fbf7f41638657a6c3375b3555a1f8c2a0a899778c4feeafbff32ba'),
  },
  {
    file: 'update.json',
    url: 'https://sealgram-updates.vercel.app/api/update',
    key: keyFromHex('06850cbaef0a335e0387d922c61a4431c08c708b1b993e1cff4c35973110b035'),
  },
  {
    file: 'update-android.json',
    url: 'https://sealgram-updates.vercel.app/api/update-android',
    key: keyFromHex('1d845a8134af7de6b3f186e1c1a52d94afdcefbb0d06869797e9a700a5f3da58'),
  },
]

const out = process.argv[2]
mkdirSync(out, { recursive: true })

let failures = 0
for (const feed of FEEDS) {
  try {
    const response = await fetch(feed.url, { signal: AbortSignal.timeout(20000) })
    const body = await response.text()
    const envelope = JSON.parse(body)
    if (!response.ok
      || typeof envelope.payload !== 'string'
      || typeof envelope.signature !== 'string') {
      throw new Error(`bad response ${response.status}`)
    }
    // Buffer accepts both base64 and base64url; the feeds use one each.
    const valid = verify(
      null,
      Buffer.from(envelope.payload, 'utf8'),
      feed.key,
      Buffer.from(envelope.signature, 'base64'))
    if (!valid) {
      throw new Error('signature does not verify')
    }
    writeFileSync(`${out}/${feed.file}`, body)
    console.log(`${feed.file}: ok, ${body.length} bytes`)
  } catch (error) {
    failures++
    console.log(`${feed.file}: SKIPPED - ${error.message}`)
  }
}
if (failures === FEEDS.length) {
  process.exit(1)
}
