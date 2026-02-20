import React from 'react';

interface ProofOverlayProps {
    elapsedTime: number;
}

export default function ProofOverlay({ elapsedTime }: ProofOverlayProps) {
    return (
        <div className="proof-overlay">
            <div className="proof-card glass-card">
                <div className="proof-spinner" />

                <div className="proof-status-text">Generating ZK Proof</div>

                <p className="proof-subtitle">
                    Your browser is computing a Zero-Knowledge proof to verify your
                    response without revealing your fleet positions. This runs entirely
                    on your device — your data never leaves the browser.
                </p>

                <div className="proof-timer">{elapsedTime.toFixed(1)}s</div>

                <div
                    className="zk-badge"
                    style={{ marginTop: 20, justifyContent: 'center' }}
                >
                    <span className="zk-badge-dot" />
                    Noir WASM + Barretenberg Backend
                </div>
            </div>
        </div>
    );
}
