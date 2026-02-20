import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    GameState,
    GamePhase,
    CellState,
    createInitialState,
    SHIPS,
    boardToFleetGrid,
    generateSalt,
    formatAddress,
    TOTAL_SHIP_CELLS,
} from './lib/gameState';
import { connectWallet, isFreighterInstalled } from './lib/stellar';
import { gameSocket } from './lib/socket';
import Lobby from './components/Lobby';
import FleetPlacement from './components/FleetPlacement';
import GameBoard from './components/GameBoard';
import GameOver from './components/GameOver';
import ProofOverlay from './components/ProofOverlay';

// ============================================================================
// Main App Component — Multiplayer via WebSocket Relay
// ============================================================================

const PHASE_STEPS: { phase: GamePhase[]; label: string }[] = [
    { phase: ['connecting'], label: 'Connect' },
    { phase: ['waiting_opponent'], label: 'Lobby' },
    { phase: ['placing', 'committing', 'waiting_commits'], label: 'Deploy Fleet' },
    { phase: ['your_turn', 'opponent_turn', 'proving', 'waiting_proof'], label: 'Battle' },
    { phase: ['game_over'], label: 'Result' },
];

function getPhaseIndex(phase: GamePhase): number {
    return PHASE_STEPS.findIndex((step) => step.phase.includes(phase));
}

export default function App() {
    const [game, setGame] = useState<GameState>(createInitialState);
    const [error, setError] = useState<string | null>(null);
    const [proofTime, setProofTime] = useState(0);
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [playerIndex, setPlayerIndex] = useState<number>(0);

    // Ref for game state in WebSocket callbacks (avoids stale closure)
    const gameRef = useRef(game);
    gameRef.current = game;

    // ========================================================================
    // Wallet Connection
    // ========================================================================
    const handleConnect = useCallback(async () => {
        try {
            setError(null);
            const address = await connectWallet();
            setGame((prev) => ({
                ...prev,
                phase: 'waiting_opponent' as GamePhase,
                playerAddress: address,
            }));
        } catch (err: any) {
            setError(err.message || 'Failed to connect wallet');
        }
    }, []);

    // ========================================================================
    // Room / Lobby
    // ========================================================================
    const handleGameStart = useCallback(
        (code: string, pIndex: number, opponentAddr: string) => {
            setRoomCode(code);
            setPlayerIndex(pIndex);
            setGame((prev) => ({
                ...prev,
                opponentAddress: opponentAddr,
                phase: 'placing' as GamePhase,
            }));
        },
        []
    );

    // ========================================================================
    // WebSocket Event Listeners
    // ========================================================================
    useEffect(() => {
        // --- Opponent committed their fleet ---
        const unsubCommit = gameSocket.on('opponent_committed', () => {
            setGame((prev) => {
                // If we already committed, both are ready → wait for battle_start
                if (prev.phase === 'waiting_commits') {
                    return prev; // battle_start will transition us
                }
                return prev;
            });
        });

        // --- Battle starts (both committed) ---
        const unsubBattle = gameSocket.on('battle_start', (msg) => {
            setGame((prev) => ({
                ...prev,
                phase: msg.yourTurn ? 'your_turn' as GamePhase : 'opponent_turn' as GamePhase,
            }));
        });

        // --- Incoming shot from opponent ---
        const unsubShot = gameSocket.on('incoming_shot', (msg) => {
            const g = gameRef.current;
            const { x, y } = msg;

            // Check if the shot hits our fleet
            const cell = g.myBoard[y][x];
            const isHit = cell === 'ship';

            // Update our board
            setGame((prev) => {
                const newBoard = prev.myBoard.map((row) => [...row]);
                newBoard[y][x] = isHit ? 'hit' : 'miss';
                const newHits = prev.myHitsReceived + (isHit ? 1 : 0);

                return {
                    ...prev,
                    myBoard: newBoard,
                    myHitsReceived: newHits,
                    opponentShots: [...prev.opponentShots, { x, y, isHit }],
                };
            });

            // Send response back to opponent
            gameSocket.shotResponse(x, y, isHit);

            // Check if we lost (all our ships sunk)
            const g2 = gameRef.current;
            const newHitCount = g2.myHitsReceived + (isHit ? 1 : 0);
            if (newHitCount >= TOTAL_SHIP_CELLS) {
                setGame((prev) => ({
                    ...prev,
                    phase: 'game_over' as GamePhase,
                    winner: prev.opponentAddress || 'opponent',
                    isWinner: false,
                }));
            } else {
                // Now it's our turn to fire
                setGame((prev) => ({
                    ...prev,
                    phase: 'your_turn' as GamePhase,
                }));
            }
        });

        // --- Shot result from opponent (our shot's outcome) ---
        const unsubResult = gameSocket.on('shot_result', (msg) => {
            const { x, y, isHit } = msg;

            setGame((prev) => {
                const newBoard = prev.opponentBoard.map((row) => [...row]);
                newBoard[y][x] = isHit ? 'hit' : 'miss';
                const newHits = prev.opponentHitsReceived + (isHit ? 1 : 0);

                // Check if we won
                if (newHits >= TOTAL_SHIP_CELLS) {
                    gameSocket.gameOver();
                    return {
                        ...prev,
                        opponentBoard: newBoard,
                        opponentHitsReceived: newHits,
                        myShots: [...prev.myShots, { x, y, isHit }],
                        phase: 'game_over' as GamePhase,
                        winner: prev.playerAddress,
                        isWinner: true,
                    };
                }

                return {
                    ...prev,
                    opponentBoard: newBoard,
                    opponentHitsReceived: newHits,
                    myShots: [...prev.myShots, { x, y, isHit }],
                    phase: 'opponent_turn' as GamePhase,
                };
            });
        });

        // --- Opponent wins ---
        const unsubOpponentWins = gameSocket.on('opponent_wins', () => {
            setGame((prev) => ({
                ...prev,
                phase: 'game_over' as GamePhase,
                winner: prev.opponentAddress || 'opponent',
                isWinner: false,
            }));
        });

        // --- Opponent disconnected ---
        const unsubDisconnect = gameSocket.on('opponent_disconnected', () => {
            setError('Opponent disconnected from the game.');
            setGame((prev) => ({
                ...prev,
                phase: 'game_over' as GamePhase,
                winner: prev.playerAddress,
                isWinner: true,
            }));
        });

        return () => {
            unsubCommit();
            unsubBattle();
            unsubShot();
            unsubResult();
            unsubOpponentWins();
            unsubDisconnect();
        };
    }, []);

    // ========================================================================
    // Fleet Commitment
    // ========================================================================
    const handleFleetCommit = useCallback(
        async (board: CellState[][]) => {
            setGame((prev) => ({ ...prev, phase: 'committing' as GamePhase }));

            try {
                const fleetGrid = boardToFleetGrid(board);
                const salt = generateSalt();

                // Notify server that our fleet is committed
                gameSocket.fleetCommitted();

                setGame((prev) => ({
                    ...prev,
                    myBoard: board,
                    fleetGrid,
                    salt,
                    commitment: 'commitment_placeholder',
                    phase: 'waiting_commits' as GamePhase,
                }));
            } catch (err: any) {
                setError(err.message || 'Failed to commit fleet');
                setGame((prev) => ({ ...prev, phase: 'placing' as GamePhase }));
            }
        },
        []
    );

    // ========================================================================
    // Fire Shot (multiplayer)
    // ========================================================================
    const handleFireShot = useCallback(
        (x: number, y: number) => {
            // Send shot to opponent via WebSocket
            gameSocket.fireShot(x, y);

            // Transition to waiting for response
            setGame((prev) => ({
                ...prev,
                phase: 'waiting_proof' as GamePhase,
            }));
        },
        []
    );

    // ========================================================================
    // Proof timer
    // ========================================================================
    useEffect(() => {
        if (game.phase !== 'proving') {
            setProofTime(0);
            return;
        }
        const interval = setInterval(() => {
            setProofTime((t) => t + 0.1);
        }, 100);
        return () => clearInterval(interval);
    }, [game.phase]);

    // ========================================================================
    // Restart
    // ========================================================================
    const handleRestart = useCallback(() => {
        gameSocket.disconnect();
        setGame(createInitialState);
        setRoomCode(null);
        setError(null);
    }, []);

    // ========================================================================
    // Render
    // ========================================================================
    const currentPhaseIndex = getPhaseIndex(game.phase);

    return (
        <>
            {/* --- Header --- */}
            <header className="app-header">
                <div className="logo">
                    <div className="logo-icon">⚓</div>
                    <span className="logo-text">ZK Battleship</span>
                </div>

                <div className="wallet-info">
                    {roomCode && (
                        <span
                            className="network-badge"
                            style={{ background: 'rgba(0, 229, 255, 0.12)', color: 'var(--accent-cyan)', borderColor: 'rgba(0, 229, 255, 0.3)' }}
                            title="Room Code"
                        >
                            🏠 {roomCode}
                        </span>
                    )}
                    {game.playerAddress && (
                        <>
                            <span className="network-badge">Testnet</span>
                            <span className="wallet-address">
                                {formatAddress(game.playerAddress)}
                            </span>
                        </>
                    )}
                </div>
            </header>

            {/* --- Phase Indicator --- */}
            {game.phase !== 'connecting' && (
                <div className="app-main" style={{ paddingBottom: 0, gap: 16 }}>
                    <div className="phase-indicator">
                        {PHASE_STEPS.map((step, i) => (
                            <div
                                key={i}
                                className={`phase-step ${i === currentPhaseIndex ? 'active' : i < currentPhaseIndex ? 'completed' : ''
                                    }`}
                            >
                                <span className="phase-step-number">
                                    {i < currentPhaseIndex ? '✓' : i + 1}
                                </span>
                                {step.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* --- Main Content --- */}
            <main className="app-main">
                {/* Error Banner */}
                {error && (
                    <div
                        className="glass-card"
                        style={{
                            background: 'rgba(255, 59, 92, 0.12)',
                            borderColor: 'rgba(255, 59, 92, 0.3)',
                            maxWidth: 500,
                            textAlign: 'center',
                        }}
                    >
                        <p style={{ color: 'var(--accent-red)', fontWeight: 600 }}>{error}</p>
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: 12 }}
                            onClick={() => setError(null)}
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {/* -- Connecting Screen -- */}
                {game.phase === 'connecting' && (
                    <div className="connect-screen">
                        <h1>ZK Battleship</h1>
                        <p className="connect-description">
                            The first provably fair, fully trustless Battleship game on Stellar.
                            Every move is verified by Zero-Knowledge proofs — cheating is
                            mathematically impossible.
                        </p>

                        <div className="features-grid">
                            <div className="feature-item glass-card">
                                <div className="feature-icon">🔐</div>
                                <div className="feature-title">Zero-Knowledge Proofs</div>
                                <div className="feature-desc">
                                    Prove hits without revealing your fleet
                                </div>
                            </div>
                            <div className="feature-item glass-card">
                                <div className="feature-icon">⛓️</div>
                                <div className="feature-title">Fully On-Chain</div>
                                <div className="feature-desc">
                                    Every move settled on Stellar Testnet
                                </div>
                            </div>
                            <div className="feature-item glass-card">
                                <div className="feature-icon">🛡️</div>
                                <div className="feature-title">Trustless</div>
                                <div className="feature-desc">
                                    No server, no referee, no cheating
                                </div>
                            </div>
                        </div>

                        <button className="btn btn-primary" onClick={handleConnect}>
                            {isFreighterInstalled()
                                ? '🔗 Connect Freighter Wallet'
                                : '🔗 Connect Wallet (Demo Mode)'}
                        </button>

                        <div className="zk-badge">
                            <span className="zk-badge-dot" />
                            Powered by Noir ZK + Stellar Protocol 25
                        </div>
                    </div>
                )}

                {/* -- Lobby: Create or Join Game -- */}
                {game.phase === 'waiting_opponent' && (
                    <Lobby
                        playerAddress={game.playerAddress || ''}
                        onGameStart={handleGameStart}
                        onError={setError}
                    />
                )}

                {/* -- Fleet Placement Phase -- */}
                {(game.phase === 'placing' || game.phase === 'committing') && (
                    <FleetPlacement
                        onCommit={handleFleetCommit}
                        isCommitting={game.phase === 'committing'}
                    />
                )}

                {/* -- Waiting for opponent to commit -- */}
                {game.phase === 'waiting_commits' && (
                    <div className="glass-card" style={{ textAlign: 'center', maxWidth: 420, padding: 40 }}>
                        <div className="proof-spinner" style={{ margin: '0 auto 20px' }} />
                        <h2 style={{ marginBottom: 8 }}>Fleet Committed! 🔒</h2>
                        <p className="text-muted">
                            Your fleet is locked in. Waiting for your opponent to deploy their fleet...
                        </p>
                    </div>
                )}

                {/* -- Battle Phase -- */}
                {(game.phase === 'your_turn' ||
                    game.phase === 'opponent_turn' ||
                    game.phase === 'waiting_proof') && (
                        <GameBoard
                            myBoard={game.myBoard}
                            opponentBoard={game.opponentBoard}
                            isMyTurn={game.phase === 'your_turn'}
                            onFireShot={handleFireShot}
                            myHits={game.opponentHitsReceived}
                            opponentHits={game.myHitsReceived}
                        />
                    )}

                {/* -- Game Over -- */}
                {game.phase === 'game_over' && (
                    <GameOver
                        isWinner={game.isWinner!}
                        myShots={game.myShots.length}
                        opponentShots={game.opponentShots.length}
                        myHits={game.opponentHitsReceived}
                        opponentHits={game.myHitsReceived}
                        onRestart={handleRestart}
                    />
                )}
            </main>

            {/* --- Proof Generation Overlay --- */}
            {game.phase === 'proving' && <ProofOverlay elapsedTime={proofTime} />}
        </>
    );
}
