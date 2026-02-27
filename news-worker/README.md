# News Worker

Daily ABC News digest workflow powered by Temporal. Fetches RSS headlines, scrapes articles, summarises with Claude, and delivers to WhatsApp subscribers.

## Build & Deploy

```bash
./build.sh
```

## Register Schedule

Register the daily 9 AM AEST schedule with Temporal:

```bash
npm run register-schedule
```

## Monitor Workflows

Port-forward the Temporal Web UI:

```bash
kubectl port-forward -n temporal svc/temporal-web 8080:8080
```

Then open http://localhost:8080 to view workflow runs, activity history, and errors.

## Manually Trigger

Use the "Run Now" button on the Workflows tab, or call the API directly:

```bash
curl -X POST http://localhost:3000/api/news/trigger -H "Authorization: Bearer <token>"
```
