// ============================================================================
// ZK Battleship — WebSocket Relay Server
// ============================================================================
// Lightweight relay server for two-player multiplayer. Does NOT see fleet
// positions — only relays encrypted/hashed messages between players.
//
// Protocol:
//   Client → Server: { type, roomCode?, ... }
//   Server → Client: { type, ... }
//
// Message types:
//   create_room     → server generates a 6-char room code
//   join_room       → connect to an existing room by code
//   fleet_committed → notify opponent that fleet hash was submitted
//   fire_shot       → send shot coordinates to opponent
//   shot_response   → send hit/miss + ZK proof back
//   game_over       → notify opponent of victory
// ============================================================================

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3001;

/** @type {Map<string, { players: any[], phase: string }>} */
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 for readability
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function broadcastToRoom(roomCode, message, excludeWs = null) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const data = JSON.stringify(message);
    for (const player of room.players) {
        if (player.ws !== excludeWs && player.ws.readyState === 1) {
            player.ws.send(data);
        }
    }
}

function sendTo(ws, message) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

function getPlayerIndex(roomCode, ws) {
    const room = rooms.get(roomCode);
    if (!room) return -1;
    return room.players.findIndex((p) => p.ws === ws);
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

console.log(`🚀 ZK Battleship relay server running on ws://0.0.0.0:${PORT}`);

wss.on('connection', (ws) => {
    let playerRoom = null;

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            sendTo(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }

        switch (msg.type) {
            // ================================================================
            // CREATE ROOM
            // ================================================================
            case 'create_room': {
                // Generate unique room code
                let code;
                do { code = generateRoomCode(); } while (rooms.has(code));

                rooms.set(code, {
                    players: [{ ws, address: msg.address || 'Player1', committed: false }],
                    phase: 'waiting',
                });
                playerRoom = code;

                sendTo(ws, {
                    type: 'room_created',
                    roomCode: code,
                    playerIndex: 0,
                });

                console.log(`[Room ${code}] Created by ${msg.address || 'anon'}`);
                break;
            }

            // ================================================================
            // JOIN ROOM
            // ================================================================
            case 'join_room': {
                const code = (msg.roomCode || '').toUpperCase().trim();
                const room = rooms.get(code);

                if (!room) {
                    sendTo(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
                    return;
                }

                if (room.players.length >= 2) {
                    sendTo(ws, { type: 'error', message: 'Room is full.' });
                    return;
                }

                room.players.push({ ws, address: msg.address || 'Player2', committed: false });
                room.phase = 'placing';
                playerRoom = code;

                // Cancel any pending room deletion
                if (room.deleteTimer) {
                    clearTimeout(room.deleteTimer);
                    room.deleteTimer = null;
                }

                // Notify the joiner
                sendTo(ws, {
                    type: 'room_joined',
                    roomCode: code,
                    playerIndex: 1,
                    opponentAddress: room.players[0].address,
                });

                // Notify the creator
                sendTo(room.players[0].ws, {
                    type: 'opponent_joined',
                    opponentAddress: msg.address || 'Player2',
                });

                console.log(`[Room ${code}] Player 2 joined: ${msg.address || 'anon'}`);
                break;
            }

            // ================================================================
            // FLEET COMMITTED
            // ================================================================
            case 'fleet_committed': {
                if (!playerRoom) return;
                const room = rooms.get(playerRoom);
                if (!room) return;

                const idx = getPlayerIndex(playerRoom, ws);
                if (idx >= 0) room.players[idx].committed = true;

                // Notify opponent
                broadcastToRoom(playerRoom, {
                    type: 'opponent_committed',
                }, ws);

                // If both committed, start the game
                if (room.players.every((p) => p.committed)) {
                    room.phase = 'battle';
                    // Player 0 (creator) goes first
                    for (let i = 0; i < room.players.length; i++) {
                        sendTo(room.players[i].ws, {
                            type: 'battle_start',
                            yourTurn: i === 0,
                        });
                    }
                    console.log(`[Room ${playerRoom}] Battle begins!`);
                }
                break;
            }

            // ================================================================
            // FIRE SHOT
            // ================================================================
            case 'fire_shot': {
                if (!playerRoom) return;
                broadcastToRoom(playerRoom, {
                    type: 'incoming_shot',
                    x: msg.x,
                    y: msg.y,
                }, ws);
                console.log(`[Room ${playerRoom}] Shot fired at (${msg.x}, ${msg.y})`);
                break;
            }

            // ================================================================
            // SHOT RESPONSE (hit/miss + proof)
            // ================================================================
            case 'shot_response': {
                if (!playerRoom) return;
                broadcastToRoom(playerRoom, {
                    type: 'shot_result',
                    x: msg.x,
                    y: msg.y,
                    isHit: msg.isHit,
                    proof: msg.proof || null,
                }, ws);
                console.log(`[Room ${playerRoom}] Response: ${msg.isHit ? 'HIT' : 'MISS'} at (${msg.x}, ${msg.y})`);
                break;
            }

            // ================================================================
            // GAME OVER
            // ================================================================
            case 'game_over': {
                if (!playerRoom) return;
                broadcastToRoom(playerRoom, {
                    type: 'opponent_wins',
                }, ws);
                console.log(`[Room ${playerRoom}] Game over!`);
                // Clean up room
                rooms.delete(playerRoom);
                playerRoom = null;
                break;
            }

            default:
                sendTo(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
    });

    ws.on('close', () => {
        if (playerRoom) {
            const room = rooms.get(playerRoom);
            if (room) {
                // Remove the disconnected player's websocket
                room.players = room.players.filter((p) => p.ws !== ws);

                if (room.phase === 'battle') {
                    // During battle, notify the other player
                    broadcastToRoom(playerRoom, {
                        type: 'opponent_disconnected',
                    }, ws);
                }

                // If room empty, keep it alive for 2 minutes for reconnection
                if (room.players.length === 0) {
                    console.log(`[Room ${playerRoom}] Empty — will delete in 2 minutes if no one rejoins`);
                    room.deleteTimer = setTimeout(() => {
                        if (rooms.has(playerRoom) && rooms.get(playerRoom).players.length === 0) {
                            rooms.delete(playerRoom);
                            console.log(`[Room ${playerRoom}] Deleted (timeout)`);
                        }
                    }, 2 * 60 * 1000);
                } else {
                    console.log(`[Room ${playerRoom}] Player disconnected, ${room.players.length} remaining`);
                }
            }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

// Clean up stale rooms every 5 minutes
setInterval(() => {
    for (const [code, room] of rooms) {
        const allClosed = room.players.every((p) => p.ws.readyState !== 1);
        if (allClosed) {
            rooms.delete(code);
            console.log(`[Room ${code}] Cleaned up (stale)`);
        }
    }
}, 5 * 60 * 1000);
