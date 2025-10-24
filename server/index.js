// Minimal Node.js server for Wortkunst (HTTP + WebSocket)
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { WebSocketServer } from 'ws';
import { createGame, startGame, getGame, serializeStateForSeat, joinSeatByToken, handleMovePlace, handleExchange, handlePass, markDisconnected, getSeatFromToken, getPublicGameSummary } from './game.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3008;

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    return `${proto}://${host}`;
}

function serveStatic(req, res) {
    let reqUrl = req.url || '/';
    if (reqUrl.startsWith('/api/') || reqUrl.startsWith('/ws')) return false;
    // SPA route handling: serve index.html for game URLs /g/:gameId/p/:seatToken
    if (reqUrl === '/' || reqUrl.startsWith('/g/')) {
        const indexPath = path.join(publicDir, 'index.html');
        try {
            const content = fs.readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        } catch (e) {
            res.writeHead(404);
            res.end('Not found');
        }
        return true;
    }
    // asset file
    const filePath = path.join(publicDir, reqUrl.replace(/^\/+/, ''));
    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return true;
    }
    try {
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        res.end(content);
        return true;
    } catch (e) {
        return false;
    }
}

const server = http.createServer(async (req, res) => {
    try {
        if (serveStatic(req, res)) return;

        const method = req.method || 'GET';
        const parsed = new URL(req.url || '/', `http://localhost:${PORT}`);

        // Create game
        if (method === 'POST' && parsed.pathname === '/api/games') {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                try {
                    const json = body ? JSON.parse(body) : {};
                    const playerCount = Math.max(1, Math.min(4, Number(json.playerCount) || 1));
                    const llm = typeof json.llm === 'string' ? json.llm : 'mistral';
                    const game = createGame(playerCount, getBaseUrl(req), llm);
                    sendJson(res, 200, {
                        gameId: game.gameId,
                        playerUrls: game.playerSeats.map((s) => `${getBaseUrl(req)}/g/${game.gameId}/p/${s.seatToken}`)
                    });
                } catch (e) {
                    sendJson(res, 400, { error: 'Invalid request' });
                }
            });
            return;
        }

        // Start game
        if (method === 'POST' && /^\/api\/games\/[A-Za-z0-9_-]+\/start$/.test(parsed.pathname)) {
            const gameId = parsed.pathname.split('/')[3];
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                try {
                    const json = body ? JSON.parse(body) : {};
                    const seatToken = json.seatToken;
                    const game = getGame(gameId);
                    if (!game) return sendJson(res, 404, { error: 'Not found' });
                    const ok = startGame(gameId, seatToken);
                    if (!ok) return sendJson(res, 400, { error: 'Cannot start' });
                    broadcastGame(gameId);
                    sendJson(res, 200, { ok: true });
                } catch (e) {
                    sendJson(res, 400, { error: 'Invalid request' });
                }
            });
            return;
        }

        // Fallback
        res.writeHead(404);
        res.end('Not found');
    } catch (e) {
        res.writeHead(500);
        res.end('Server error');
    }
});

const wss = new WebSocketServer({ noServer: true });

const gameIdToClients = new Map(); // gameId -> Set(ws)

function broadcastGame(gameId) {
    const clients = gameIdToClients.get(gameId);
    if (!clients) return;
    for (const ws of clients) {
        const { gameId: gid, seatToken } = ws.__ctx || {};
        const game = getGame(gameId);
        if (!game) continue;
        if (gid !== gameId) continue;
        const seat = getSeatFromToken(game, seatToken);
        if (!seat) continue;
        const payload = serializeStateForSeat(game, seat.seatId);
        safeSend(ws, { type: 'state', payload });
    }
}

function safeSend(ws, data) {
    try {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
    } catch { }
}

server.on('upgrade', (request, socket, head) => {
    const { url: requestUrl } = request;
    if (!requestUrl || !requestUrl.startsWith('/ws')) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(String(data));
        } catch {
            return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'join') {
            const { gameId, seatToken, displayName } = msg;
            const game = getGame(gameId);
            if (!game) return safeSend(ws, { type: 'error', error: 'not_found' });
            const seat = joinSeatByToken(gameId, seatToken, displayName);
            if (!seat) return safeSend(ws, { type: 'error', error: 'cannot_join' });
            ws.__ctx = { gameId, seatToken };
            if (!gameIdToClients.has(gameId)) gameIdToClients.set(gameId, new Set());
            gameIdToClients.get(gameId).add(ws);
            ws.on('close', () => {
                const set = gameIdToClients.get(gameId);
                if (set) set.delete(ws);
                markDisconnected(gameId, seat.seatId);
                broadcastGame(gameId);
            });
            broadcastGame(gameId);
            safeSend(ws, { type: 'joined', payload: getPublicGameSummary(getGame(gameId)) });
            return;
        }

        // All other actions require join
        const ctx = ws.__ctx;
        if (!ctx) return;
        const game = getGame(ctx.gameId);
        if (!game) return;

        if (msg.type === 'request_state') {
            const seat = getSeatFromToken(game, ctx.seatToken);
            if (!seat) return;
            safeSend(ws, { type: 'state', payload: serializeStateForSeat(game, seat.seatId) });
            return;
        }

        if (msg.type === 'place') {
            const result = await handleMovePlace(game, ctx.seatToken, msg.tiles);
            if (result.ok) {
                broadcastGame(game.gameId);
            } else {
                safeSend(ws, { type: 'error', error: result.error || 'invalid_move' });
            }
            return;
        }

        if (msg.type === 'exchange') {
            const result = handleExchange(game, ctx.seatToken, msg.rackIndices);
            if (result.ok) broadcastGame(game.gameId);
            else safeSend(ws, { type: 'error', error: result.error || 'cannot_exchange' });
            return;
        }

        if (msg.type === 'pass') {
            const result = handlePass(game, ctx.seatToken);
            if (result.ok) broadcastGame(game.gameId);
            else safeSend(ws, { type: 'error', error: result.error || 'cannot_pass' });
            return;
        }
    });
});

server.listen(PORT, () => {
    console.log(`Wortkunst listening on http://localhost:${PORT}`);
});


