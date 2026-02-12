# CRX Grabber

Download Chrome extensions as `.zip` files, ready to sideload in Developer Mode.

## Why ZIP instead of CRX?

Chrome blocks installing `.crx` files from outside the Chrome Web Store. To sideload an extension you need to:

1. Download the extension using CRX Grabber (saves as `.zip`)
2. Unzip the downloaded file
3. Open `chrome://extensions` and enable **Developer Mode**
4. Click **Load unpacked** and select the unzipped folder

CRX files aren't just renamed ZIPs — they have a binary header (magic bytes, version, cryptographic signatures) prepended to the ZIP data. CRX Grabber strips this header server-side, so the downloaded `.zip` is a standard archive you can unzip directly.

## Development

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com)
- Deployed on [Vercel](https://vercel.com)
