# Security Policy

Report vulnerabilities through a private GitHub security advisory. Do not open a public issue containing App IDs, App Secrets, QR codes, tenant tokens, chat IDs, or saved credential files.

The plugin stores long-lived credentials under `$DSH_HOME/feishu-bot/credentials.json` with owner-only permissions. Production deployments should configure `FEISHU_ALLOWED_CHATS` and run DSH with the least privilege required for their workflows.
