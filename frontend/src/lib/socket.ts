// ============================================================================
// WebSocket Multiplayer Client
// ============================================================================
// Manages the connection to the relay server and provides a clean API
// for sending/receiving game messages.

// Auto-detect hostname so it works both locally and across the network
const WS_HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const WS_URL = `ws://${WS_HOST}:3001`;

export type MessageHandler = (msg: any) => void;

class GameSocket {
    private ws: WebSocket | null = null;
    private handlers: Map<string, MessageHandler[]> = new Map();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;

    /** Connect to the relay server */
    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(WS_URL);

                this.ws.onopen = () => {
                    console.log('[WS] Connected to relay server');
                    this.reconnectAttempts = 0;
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        console.log('[WS] Received:', msg.type, msg);
                        const typeHandlers = this.handlers.get(msg.type) || [];
                        const wildcardHandlers = this.handlers.get('*') || [];
                        [...typeHandlers, ...wildcardHandlers].forEach((h) => h(msg));
                    } catch (err) {
                        console.error('[WS] Failed to parse message:', err);
                    }
                };

                this.ws.onclose = () => {
                    console.log('[WS] Disconnected');
                    const handlers = this.handlers.get('disconnected') || [];
                    handlers.forEach((h) => h({ type: 'disconnected' }));
                };

                this.ws.onerror = (err) => {
                    console.error('[WS] Error:', err);
                    reject(new Error('Could not connect to game server'));
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    /** Register a handler for a specific message type */
    on(type: string, handler: MessageHandler): () => void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type)!.push(handler);

        // Return unsubscribe function
        return () => {
            const list = this.handlers.get(type);
            if (list) {
                const idx = list.indexOf(handler);
                if (idx >= 0) list.splice(idx, 1);
            }
        };
    }

    /** Send a message to the server */
    send(message: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('[WS] Cannot send — not connected');
        }
    }

    /** Create a new room */
    createRoom(address: string) {
        this.send({ type: 'create_room', address });
    }

    /** Join an existing room */
    joinRoom(roomCode: string, address: string) {
        this.send({ type: 'join_room', roomCode, address });
    }

    /** Notify fleet committed */
    fleetCommitted() {
        this.send({ type: 'fleet_committed' });
    }

    /** Fire a shot */
    fireShot(x: number, y: number) {
        this.send({ type: 'fire_shot', x, y });
    }

    /** Respond to a shot */
    shotResponse(x: number, y: number, isHit: boolean, proof?: string) {
        this.send({ type: 'shot_response', x, y, isHit, proof });
    }

    /** Declare game over */
    gameOver() {
        this.send({ type: 'game_over' });
    }

    /** Disconnect */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.handlers.clear();
    }

    /** Check connection status */
    get connected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const gameSocket = new GameSocket();
