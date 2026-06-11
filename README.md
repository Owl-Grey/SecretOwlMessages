# emergency-chat-frontend

React/Vite client for the separate Emergency Chat backend. The backend is not part of this project.

## Install

```sh
npm install
```

## Run Dev

```sh
cp .env.example .env
npm run dev
```

On Windows:

```powershell
copy .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Backend Connection

Defaults:

```env
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_WS_URL=ws://127.0.0.1:3000/ws
```

Login and Register hide these in Server settings and save overrides in IndexedDB.

## Build

```sh
npm run build
npm run preview
```

Vite uses relative paths, so the build can be hosted from a GitHub Pages subdirectory.

## Crypto Model

The client uses Web Crypto API:

- each device generates an ECDH P-256 key pair
- the private key is stored only locally, encrypted with the user's storage password
- the public key is sent to the backend as `devicePublicKey`
- every message gets a random AES-GCM message key
- the message key is wrapped for each recipient device via ECDH + HKDF + AES-GCM
- the sender device is also included as a self-envelope, so sent messages can be read after reload
- IndexedDB stores only `encryptedPayload`, never plaintext
- decrypted text exists only in UI memory while a chat is open

Users do not need a shared chat password. Their storage passwords can be different.

## Sync

The chat screen syncs automatically:

- pulls on open
- pulls on window focus and visibility restore
- pulls on WebSocket `message:new`
- falls back to polling every 10 seconds when WebSocket is not connected
- ACKs pulled messages automatically after saving encrypted payloads locally
- creates local chats automatically for incoming senders
- retries failed ACKs on later sync attempts

Device history sync is available in Settings:

- Create sync package for other devices of the same account
- Check incoming packages on the target device
- Import contacts, chats, and encrypted messages
- Packages are encrypted client-side, one-time, and expire after 10 minutes

Sync packages do not include plaintext on the server.

## Notifications

Settings includes notification controls:

- In-app notifications
- Browser Notification API permission
- Browser notifications
- Hide message text in notifications

Web Push is not implemented yet.

## Files And Images

Images and files are encrypted in the browser before upload. The backend receives only an encrypted blob through the existing `/api/files/upload` endpoint.

- image limit defaults to 10 MB
- file limit defaults to 25 MB
- filenames and MIME metadata are encrypted inside the message payload
- IndexedDB stores only encrypted payloads
- previews and decrypted downloads exist only in browser memory as Blob/ObjectURL
- file blobs are downloaded only after the user clicks Load image or Download
- server-side file storage is temporary and may expire by TTL

Manual pull remains available only in the API Debug page.

## IndexedDB

Database: `EmergencyChatFrontendDB`.

Tables:

- `profiles`
- `contacts`
- `chats`
- `messages`
- `settings`
- `outbox`

Use Settings -> Wipe local data to delete IndexedDB, `localStorage`, and `sessionStorage`.

## API Debug

The Debug tab can run health, me, devices, pull, raw encrypted send, and ACK checks. Normal chat usage does not require it.
