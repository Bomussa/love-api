# Love API - Medical Committee Backend

Backend API for the Military Medical Committee System.

## Deployment

This project is deployed separately on Vercel as a standalone API project.

## Endpoints

- `GET /api/v1/status` - Health check
- `POST /api/v1/patient/login` - Patient login
- `POST /api/v1/queue/enter` - Enter queue
- `GET /api/v1/queue/status` - Get queue status
- `POST /api/v1/queue/call` - Call next patient
- `POST /api/v1/queue/done` - Mark patient as done
- `POST /api/v1/pin/generate` - Generate PIN
- `POST /api/v1/pin/verify` - Verify PIN
- And more...

## Environment Variables

- `KV_REST_API_URL` - Vercel KV REST API URL (optional)
- `KV_REST_API_TOKEN` - Vercel KV REST API Token (optional)

## Local Development

```bash
npm install -g vercel
vercel dev
```

## Deploy

Push to GitHub and Vercel will auto-deploy.

