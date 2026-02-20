import React, { useState, useCallback, useRef, useEffect } from 'react';
import { gameSocket } from '../lib/socket';

interface LobbyProps {
    playerAddress: string;
    onGameStart: (roomCode: string, playerIndex: number, opponentAddress: string) => void;
    onError: (message: string) => void;
}

export default function Lobby({ playerAddress, onGameStart, onError }: LobbyProps) {
    const [mode, setMode] = useState<'choice' | 'creating' | 'waiting' | 'joining'>('choice');
    const [roomCode, setRoomCode] = useState('');
    const [inputCode, setInputCode] = useState('');
    const [connecting, setConnecting] = useState(false);

    // Keep refs to avoid stale closures in WS callbacks
    const roomCodeRef = useRef('');
    const cleanupRef = useRef<(() => void)[]>([]);

    // Cleanup handlers when component unmounts or mode changes
    useEffect(() => {
        return () => {
            cleanupRef.current.forEach((fn) => fn());
            cleanupRef.current = [];
        };
    }, []);

    const clearHandlers = () => {
        cleanupRef.current.forEach((fn) => fn());
        cleanupRef.current = [];
    };

    const handleCreate = useCallback(async () => {
        setConnecting(true);
        setMode('creating');

        try {
            if (!gameSocket.connected) {
                await gameSocket.connect();
            }

            // Clear any previous handlers first
            clearHandlers();

            // Listen for room creation confirmation
            const unsub1 = gameSocket.on('room_created', (msg) => {
                roomCodeRef.current = msg.roomCode;
                setRoomCode(msg.roomCode);
                setMode('waiting');
                setConnecting(false);
            });

            // Listen for opponent joining — use ref for current roomCode
            const unsub2 = gameSocket.on('opponent_joined', (msg) => {
                onGameStart(roomCodeRef.current, 0, msg.opponentAddress);
            });

            const unsub3 = gameSocket.on('error', (msg) => {
                onError(msg.message);
                setMode('choice');
                setConnecting(false);
            });

            cleanupRef.current = [unsub1, unsub2, unsub3];

            gameSocket.createRoom(playerAddress);
        } catch (err: any) {
            onError(err.message || 'Failed to connect to game server');
            setMode('choice');
            setConnecting(false);
        }
    }, [playerAddress, onGameStart, onError]);

    const handleJoin = useCallback(async () => {
        const code = inputCode.trim().toUpperCase();
        if (code.length < 4) {
            onError('Please enter a valid room code');
            return;
        }

        setConnecting(true);

        try {
            if (!gameSocket.connected) {
                await gameSocket.connect();
            }

            // Clear any previous handlers first
            clearHandlers();

            const unsub1 = gameSocket.on('room_joined', (msg) => {
                setConnecting(false);
                onGameStart(msg.roomCode, 1, msg.opponentAddress);
            });

            const unsub2 = gameSocket.on('error', (msg) => {
                onError(msg.message);
                setConnecting(false);
            });

            cleanupRef.current = [unsub1, unsub2];

            gameSocket.joinRoom(code, playerAddress);
        } catch (err: any) {
            onError(err.message || 'Failed to connect to game server');
            setConnecting(false);
        }
    }, [inputCode, playerAddress, onGameStart, onError]);

    const copyCode = useCallback(() => {
        navigator.clipboard.writeText(roomCode);
    }, [roomCode]);

    // ========================================================================
    // Choice screen: Create or Join
    // ========================================================================
    if (mode === 'choice') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, maxWidth: 500 }}>
                <h2>⚔️ Start a Battle</h2>
                <p className="text-muted text-small" style={{ textAlign: 'center' }}>
                    Create a new game room and share the code, or join an existing game with a code from your opponent.
                </p>

                <div style={{ display: 'flex', gap: 16, width: '100%' }}>
                    <button
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '20px 16px', flexDirection: 'column', gap: 4 }}
                        onClick={handleCreate}
                    >
                        <span style={{ fontSize: '1.5rem' }}>🏴‍☠️</span>
                        <span>Create Game</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Get a room code</span>
                    </button>

                    <button
                        className="btn btn-secondary"
                        style={{ flex: 1, padding: '20px 16px', flexDirection: 'column', gap: 4 }}
                        onClick={() => setMode('joining')}
                    >
                        <span style={{ fontSize: '1.5rem' }}>🎯</span>
                        <span>Join Game</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Enter a room code</span>
                    </button>
                </div>
            </div>
        );
    }

    // ========================================================================
    // Waiting screen: Room created, waiting for opponent
    // ========================================================================
    if (mode === 'waiting') {
        return (
            <div className="glass-card" style={{ textAlign: 'center', maxWidth: 460, padding: '40px 36px' }}>
                <h2 style={{ marginBottom: 8 }}>🏴‍☠️ Room Created!</h2>
                <p className="text-muted" style={{ marginBottom: 24 }}>
                    Share this code with your opponent to start the battle.
                </p>

                <div
                    onClick={copyCode}
                    title="Click to copy"
                    style={{
                        fontSize: '2.8rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        letterSpacing: '0.3em',
                        padding: '16px 32px',
                        background: 'rgba(0, 229, 255, 0.08)',
                        border: '2px dashed rgba(0, 229, 255, 0.3)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: 'var(--accent-cyan)',
                        marginBottom: 20,
                        transition: 'all 0.2s ease',
                        userSelect: 'all',
                    }}
                >
                    {roomCode}
                </div>

                <button className="btn btn-secondary" onClick={copyCode} style={{ marginBottom: 24 }}>
                    📋 Copy Code
                </button>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <div className="proof-spinner" style={{ width: 20, height: 20, margin: 0, borderWidth: 2 }} />
                    <span className="text-muted text-small">Waiting for opponent to join...</span>
                </div>
            </div>
        );
    }

    // ========================================================================
    // Creating screen: Connecting to server
    // ========================================================================
    if (mode === 'creating') {
        return (
            <div className="glass-card" style={{ textAlign: 'center', maxWidth: 400, padding: 40 }}>
                <div className="proof-spinner" style={{ margin: '0 auto 16px' }} />
                <p>Connecting to game server...</p>
            </div>
        );
    }

    // ========================================================================
    // Join screen: Enter room code
    // ========================================================================
    return (
        <div className="glass-card" style={{ textAlign: 'center', maxWidth: 460, padding: '40px 36px' }}>
            <h2 style={{ marginBottom: 8 }}>🎯 Join Game</h2>
            <p className="text-muted" style={{ marginBottom: 24 }}>
                Enter the 6-character room code from your opponent.
            </p>

            <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="ABCDEF"
                maxLength={6}
                autoFocus
                style={{
                    width: '100%',
                    padding: '14px 20px',
                    fontSize: '2rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    textAlign: 'center',
                    letterSpacing: '0.3em',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    marginBottom: 20,
                    transition: 'border-color 0.2s ease',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent-cyan)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-glass)')}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />

            <div style={{ display: 'flex', gap: 12 }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => { setMode('choice'); setInputCode(''); clearHandlers(); }}
                    style={{ flex: 1 }}
                >
                    ← Back
                </button>
                <button
                    className="btn btn-primary"
                    onClick={handleJoin}
                    disabled={inputCode.length < 4 || connecting}
                    style={{ flex: 2 }}
                >
                    {connecting ? 'Connecting...' : '⚔️ Join Battle'}
                </button>
            </div>
        </div>
    );
}
