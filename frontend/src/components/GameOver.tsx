import React from 'react';

interface GameOverProps {
    isWinner: boolean;
    myShots: number;
    opponentShots: number;
    myHits: number;
    opponentHits: number;
    onRestart: () => void;
}

export default function GameOver({
    isWinner,
    myShots,
    opponentShots,
    myHits,
    opponentHits,
    onRestart,
}: GameOverProps) {
    const accuracy = myShots > 0 ? ((myHits / myShots) * 100).toFixed(0) : '0';

    return (
        <div className="game-over glass-card">
            <div className={`game-over-title ${isWinner ? 'winner' : 'loser'}`}>
                {isWinner ? '🏆 VICTORY' : '💀 DEFEAT'}
            </div>

            <p className="game-over-subtitle">
                {isWinner
                    ? 'All enemy ships have been sunk! Result recorded on-chain.'
                    : 'Your fleet has been destroyed. Better luck next time, Admiral.'}
            </p>

            <div className="game-over-stats">
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>
                        {myShots}
                    </div>
                    <div className="stat-label">Shots Fired</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-green)' }}>
                        {accuracy}%
                    </div>
                    <div className="stat-label">Accuracy</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
                        {myHits}
                    </div>
                    <div className="stat-label">Hits Landed</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-orange)' }}>
                        {opponentShots}
                    </div>
                    <div className="stat-label">Enemy Shots</div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={onRestart}>
                    ⚓ New Game
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={() => window.open('https://stellar.expert/explorer/testnet', '_blank')}
                >
                    🔍 View on Explorer
                </button>
            </div>

            <div className="zk-badge" style={{ marginTop: 24, justifyContent: 'center' }}>
                <span className="zk-badge-dot" />
                Result permanently recorded on Stellar blockchain
            </div>
        </div>
    );
}
