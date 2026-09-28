# MATRIX SOCIAL

A hacker-style social platform starter with a Matrix-inspired UI.

## Included

- Realtime direct messages with Socket.IO
- Group creation, joining and realtime group chat
- WebRTC voice/video calls with signaling through Socket.IO
- Ephemeral "Instants" that expire after 24 hours
- Status updates
- Floating customizable CRAI assistant
- Light/dark theme switching, dark by default
- Responsive UI
- In-memory demo data (replace with a database for production)
- Optional OpenAI-compatible CRAI endpoint
- GitHub-friendly source structure

## Requirements

- Node.js 20+
- Modern browser with WebRTC support

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

On Windows PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

## Demo usage

The app asks for a username on first load. Open the site in two browser tabs/windows with different names to test DMs and calls.

For WebRTC calls:
1. Open the app in two browser windows.
2. Select the other online user.
3. Click Voice or Video.
4. Allow microphone/camera permissions.
5. Answer the incoming call in the second window.

For groups:
1. Open Groups.
2. Create a group.
3. Join it from another session or use the created group.
4. Send messages.

## CRAI

CRAI works immediately with a local assistant, so the demo has no mandatory API dependency.

To connect an OpenAI-compatible backend, set:

```env
AI_API_URL=https://your-provider.example/v1/chat/completions
AI_API_KEY=your-secret-key
AI_MODEL=your-model-name
```

The server sends the user's message to that endpoint. Keep the API key server-side; never put it in frontend JavaScript.

## Production notes

This repository is a functional prototype, not a complete production social network.

Before production:
- Replace in-memory state with PostgreSQL/Redis or another durable datastore.
- Add authentication and secure sessions.
- Add password reset, email verification and account recovery.
- Validate and rate-limit all realtime events.
- Add persistent media storage and image/video processing.
- Add moderation, reporting and abuse controls.
- Configure HTTPS.
- Configure a TURN server for reliable WebRTC connectivity.
- Add CSRF/CORS/security headers appropriate to your deployment.
- Add database migrations and automated tests.

## GitHub deployment

### Backend-capable hosting

Deploy the repository to a Node-compatible service such as Render, Railway, Fly.io or a VPS.

Set the environment variables from `.env.example`, then run:

```bash
npm install
npm start
```

### GitHub Pages

GitHub Pages can host only the static frontend. The realtime server and CRAI endpoint still need a separate backend. After deploying the backend, change `API_BASE` in `public/js/config.js` to the HTTPS backend URL and publish `public/` through GitHub Pages.

## License

Use and modify this starter for your own project. Add an appropriate license before public distribution.
