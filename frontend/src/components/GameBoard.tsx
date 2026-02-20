import React from 'react';
import { CellState, BOARD_SIZE, TOTAL_SHIP_CELLS } from '../lib/gameState';

interface GameBoardProps {
    myBoard: CellState[][];
    opponentBoard: CellState[][];
    isMyTurn: boolean;
    onFireShot: (x: number, y: number) => void;
    myHits: number;      // Hits I've landed on opponent
    opponentHits: number; // Hits opponent has landed on me
}

export default function GameBoard({
    myBoard,
    opponentBoard,
    isMyTurn,
    onFireShot,
    myHits,
    opponentHits,
}: GameBoardProps) {
    const colLabels = 'ABCDEFGHIJ'.split('');
    const rowLabels = Array.from({ length: 10 }, (_, i) => String(i + 1));

    const handleClick = (x: number, y: number) => {
        if (!isMyTurn) return;
        if (opponentBoard[y][x] !== 'empty') return; // Already shot
        onFireShot(x, y);
    };

    return (
        <>
            {/* Turn Indicator */}
            <div className={`turn-indicator ${isMyTurn ? 'your-turn' : 'waiting'}`}>
                <span className="turn-dot" />
                {isMyTurn ? 'Your Turn — Fire a shot!' : "Opponent's Turn — Awaiting response..."}
            </div>

            {/* Score */}
            <div style={{ display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap' }}>
                <div className="glass-card" style={{ padding: '12px 24px', textAlign: 'center' }}>
                    <div className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                        {myHits}/{TOTAL_SHIP_CELLS}
                    </div>
                    <div className="text-muted text-small">Hits Landed</div>
                </div>
                <div className="glass-card" style={{ padding: '12px 24px', textAlign: 'center' }}>
                    <div className="text-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-red)' }}>
                        {opponentHits}/{TOTAL_SHIP_CELLS}
                    </div>
                    <div className="text-muted text-small">Hits Received</div>
                </div>
            </div>

            {/* Dual Board Layout */}
            <div className="boards-container">
                {/* My Board (defensive) */}
                <div className="board-wrapper">
                    <div className="board-label">🛡️ Your Fleet</div>
                    <div className="board-grid">
                        <div className="grid-header" />
                        {colLabels.map((l) => (
                            <div className="grid-header" key={l}>{l}</div>
                        ))}

                        {Array.from({ length: BOARD_SIZE }, (_, y) => (
                            <React.Fragment key={y}>
                                <div className="grid-header">{rowLabels[y]}</div>
                                {Array.from({ length: BOARD_SIZE }, (_, x) => {
                                    const cell = myBoard[y][x];
                                    let className = 'grid-cell';
                                    if (cell === 'ship') className += ' ship';
                                    if (cell === 'hit') className += ' hit';
                                    if (cell === 'miss') className += ' miss';

                                    return <div key={x} className={className} />;
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Opponent Board (offensive) */}
                <div className="board-wrapper">
                    <div className="board-label">🎯 Enemy Waters</div>
                    <div className="board-grid">
                        <div className="grid-header" />
                        {colLabels.map((l) => (
                            <div className="grid-header" key={l}>{l}</div>
                        ))}

                        {Array.from({ length: BOARD_SIZE }, (_, y) => (
                            <React.Fragment key={y}>
                                <div className="grid-header">{rowLabels[y]}</div>
                                {Array.from({ length: BOARD_SIZE }, (_, x) => {
                                    const cell = opponentBoard[y][x];
                                    let className = 'grid-cell';
                                    if (cell === 'hit') className += ' hit';
                                    else if (cell === 'miss') className += ' miss';
                                    else if (isMyTurn) className += ' clickable';

                                    return (
                                        <div
                                            key={x}
                                            className={className}
                                            onClick={() => handleClick(x, y)}
                                        />
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </div>

            {/* ZK Badge */}
            <div className="zk-badge" style={{ alignSelf: 'center' }}>
                <span className="zk-badge-dot" />
                Every response verified by Zero-Knowledge proof on Stellar
            </div>
        </>
    );
}
