// Diagnose the Amazon PA-API setup with one real request. Never prints keys.
// Reads AMAZON_ACCESS_KEY / AMAZON_SECRET_KEY / AMAZON_PARTNER_TAG from env
// (same names as .env.example / Render). Prints the exact HTTP status and the
// response body from Amazon so credential/eligibility problems are visible.
//
// Usage: npm run prices:debug -- --keyword="NVIDIA GeForce RTX 5090" --currency=USD

import { config } from '../src/config.js';
import { searchAmazonVerbose } from '../src/utils/amazon.js';

const args = process.argv.slice(2);
const keyword = (args.find((a) => a.startsWith('--keyword=')) || '--keyword=NVIDIA GeForce RTX 5090').split('=').slice(1).join('=');
const currency = (args.find((a) => a.startsWith('--currency=')) || '--currency=USD').split('=')[1].toUpperCase();

const masked = (v) => (v ? `${v.slice(0, 4)}...${v.slice(-4)}` : '(empty)');
console.log('configured:', Boolean(config.amazon?.accessKey && config.amazon?.secretKey && config.amazon?.partnerTag));
console.log('access key :', masked(config.amazon?.accessKey));
console.log('partner tag:', config.amazon?.partnerTag || '(empty)');
console.log(`searching "${keyword}" on ${currency} ...\n`);

const out = await searchAmazonVerbose({
  accessKey: config.amazon?.accessKey,
  secretKey: config.amazon?.secretKey,
  partnerTag: config.amazon?.partnerTag,
  currency,
  keywords: keyword,
});

console.log('HTTP status :', out.status);
if (out.error) console.log('error       :', out.error.message);
if (out.body) console.log('body        :', out.body.slice(0, 2000));
if (out.result) console.log('result      :', JSON.stringify(out.result, null, 2));
