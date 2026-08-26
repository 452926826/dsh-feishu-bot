# Contributing

Use Node.js 20 or newer.

```bash
npm ci --legacy-peer-deps
npm run check
npm pack --dry-run
```

Do not commit Feishu credentials, QR codes, chat state, or application secrets. Keep DSH runtime packages as host-provided peers. Update `marketplace-entry.yml` when the repository URL, category, or public description changes.
