// ============================================================================
// TxToast — On-Chain Transaction Confirmation Popup
// ============================================================================
// Shows a small toast in the bottom-right corner whenever a transaction
// is confirmed on Stellar Testnet, with a link to Stellar Expert.

import { useEffect, useState } from 'react';

export interface TxNotification {
    id: number;
    label: string;       // e.g. "Fleet Committed"
    txHash: string;      // real tx hash from Testnet
}

interface Props {
    toasts: TxNotification[];
    onDismiss: (id: number) => void;
}

export default function TxToast({ toasts, onDismiss }: Props) {
    return (
        <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 340,
        }}>
            {toasts.map((t) => (
                <Toast key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
    );
}

function Toast({ toast, onDismiss }: { toast: TxNotification; onDismiss: (id: number) => void }) {
    const [visible, setVisible] = useState(false);

    // Fade in
    useEffect(() => {
        const t = setTimeout(() => setVisible(true), 10);
        return () => clearTimeout(t);
    }, []);

    // Auto-dismiss after 9 seconds
    useEffect(() => {
        const t = setTimeout(() => onDismiss(toast.id), 9000);
        return () => clearTimeout(t);
    }, [toast.id, onDismiss]);

    const short = `${toast.txHash.slice(0, 8)}...${toast.txHash.slice(-6)}`;
    const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${toast.txHash}`;

    return (
        <div style={{
            background: 'rgba(10, 20, 40, 0.96)',
            border: '1px solid rgba(0, 229, 255, 0.35)',
            borderRadius: 12,
            padding: '12px 14px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            transform: visible ? 'translateY(0)' : 'translateY(20px)',
            opacity: visible ? 1 : 0,
            transition: 'transform 0.25s ease, opacity 0.25s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
        }}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {/* Pulsing green dot */}
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#22d3a7',
                        boxShadow: '0 0 6px #22d3a7',
                        display: 'inline-block',
                        animation: 'pulse 1.5s ease-in-out 3',
                    }} />
                    <span style={{ color: '#22d3a7', fontWeight: 700, fontSize: 13 }}>
                        ⛓ On-Chain Confirmed
                    </span>
                </div>
                <button
                    onClick={() => onDismiss(toast.id)}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#8899aa', fontSize: 16, lineHeight: 1, padding: '0 2px',
                    }}
                >×</button>
            </div>

            {/* Action label */}
            <div style={{ color: '#e0eaff', fontSize: 13, fontWeight: 600 }}>
                {toast.label}
            </div>

            {/* TX hash + link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    padding: '3px 7px',
                    fontSize: 11,
                    color: '#aac8ff',
                    fontFamily: 'monospace',
                    letterSpacing: '0.03em',
                }}>
                    {short}
                </code>
                <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        color: '#00e5ff',
                        fontSize: 11,
                        fontWeight: 600,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                    }}
                >
                    View on Explorer ↗
                </a>
            </div>
        </div>
    );
}
