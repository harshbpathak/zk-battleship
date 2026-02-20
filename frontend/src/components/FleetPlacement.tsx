import React, { useState, useCallback } from 'react';
import {
    SHIPS,
    ShipDef,
    CellState,
    PlacedShip,
    BOARD_SIZE,
    createEmptyBoard,
    canPlaceShip,
    placeShipOnBoard,
    removeShipFromBoard,
} from '../lib/gameState';

interface FleetPlacementProps {
    onCommit: (board: CellState[][]) => void;
    isCommitting: boolean;
}

export default function FleetPlacement({ onCommit, isCommitting }: FleetPlacementProps) {
    const [board, setBoard] = useState<CellState[][]>(createEmptyBoard);
    const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
    const [selectedShip, setSelectedShip] = useState<ShipDef | null>(SHIPS[0]);
    const [horizontal, setHorizontal] = useState(true);
    const [hoverCells, setHoverCells] = useState<{ x: number; y: number; valid: boolean }[]>([]);

    const isShipPlaced = (shipId: string) =>
        placedShips.some((p) => p.shipId === shipId);

    const allShipsPlaced = placedShips.length === SHIPS.length;

    // Preview cells on hover
    const handleCellHover = useCallback(
        (x: number, y: number) => {
            if (!selectedShip || isShipPlaced(selectedShip.id)) {
                setHoverCells([]);
                return;
            }

            const cells: { x: number; y: number; valid: boolean }[] = [];
            const valid = canPlaceShip(board, selectedShip, x, y, horizontal);

            for (let i = 0; i < selectedShip.size; i++) {
                const cx = horizontal ? x + i : x;
                const cy = horizontal ? y : y + i;
                if (cx < BOARD_SIZE && cy < BOARD_SIZE) {
                    cells.push({ x: cx, y: cy, valid });
                }
            }
            setHoverCells(cells);
        },
        [selectedShip, horizontal, board, placedShips]
    );

    // Place ship on click
    const handleCellClick = useCallback(
        (x: number, y: number) => {
            if (!selectedShip || isShipPlaced(selectedShip.id)) return;
            if (!canPlaceShip(board, selectedShip, x, y, horizontal)) return;

            const newBoard = board.map((row) => [...row]);
            placeShipOnBoard(newBoard, selectedShip, x, y, horizontal);

            const newPlaced = [
                ...placedShips,
                { shipId: selectedShip.id, startX: x, startY: y, horizontal },
            ];

            setBoard(newBoard);
            setPlacedShips(newPlaced);
            setHoverCells([]);

            // Auto-select next unplaced ship
            const nextShip = SHIPS.find((s) => !newPlaced.some((p) => p.shipId === s.id));
            setSelectedShip(nextShip || null);
        },
        [selectedShip, horizontal, board, placedShips]
    );

    // Remove a placed ship
    const handleRemoveShip = useCallback(
        (shipId: string) => {
            const placement = placedShips.find((p) => p.shipId === shipId);
            if (!placement) return;

            const ship = SHIPS.find((s) => s.id === shipId)!;
            const newBoard = board.map((row) => [...row]);
            removeShipFromBoard(newBoard, ship, placement);

            setBoard(newBoard);
            setPlacedShips(placedShips.filter((p) => p.shipId !== shipId));
            setSelectedShip(ship);
        },
        [board, placedShips]
    );

    // Toggle horizontal/vertical
    const toggleOrientation = useCallback(() => {
        setHorizontal((h) => !h);
        setHoverCells([]);
    }, []);

    // Reset all ships
    const handleReset = useCallback(() => {
        setBoard(createEmptyBoard());
        setPlacedShips([]);
        setSelectedShip(SHIPS[0]);
        setHoverCells([]);
    }, []);

    // Random placement
    const handleRandom = useCallback(() => {
        const newBoard = createEmptyBoard();
        const newPlaced: PlacedShip[] = [];

        for (const ship of SHIPS) {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 200) {
                const h = Math.random() > 0.5;
                const x = Math.floor(Math.random() * BOARD_SIZE);
                const y = Math.floor(Math.random() * BOARD_SIZE);
                if (canPlaceShip(newBoard, ship, x, y, h)) {
                    placeShipOnBoard(newBoard, ship, x, y, h);
                    newPlaced.push({ shipId: ship.id, startX: x, startY: y, horizontal: h });
                    placed = true;
                }
                attempts++;
            }
        }

        setBoard(newBoard);
        setPlacedShips(newPlaced);
        setSelectedShip(null);
        setHoverCells([]);
    }, []);

    // Check if a cell is part of hover preview
    const getHoverCell = (x: number, y: number) =>
        hoverCells.find((c) => c.x === x && c.y === y);

    const colLabels = 'ABCDEFGHIJ'.split('');
    const rowLabels = Array.from({ length: 10 }, (_, i) => String(i + 1));

    return (
        <>
            <h2 style={{ textAlign: 'center' }}>Deploy Your Fleet</h2>
            <p className="text-muted text-small" style={{ textAlign: 'center', maxWidth: 400 }}>
                Place your 5 ships on the grid. Click to place, right-click or press R to
                rotate. Your fleet will be committed on-chain with a ZK hash.
            </p>

            <div className="boards-container">
                {/* Grid */}
                <div className="board-wrapper">
                    <div className="board-label">Your Ocean</div>
                    <div className="board-grid" onMouseLeave={() => setHoverCells([])}>
                        {/* Column headers */}
                        <div className="grid-header" />
                        {colLabels.map((l) => (
                            <div className="grid-header" key={l}>{l}</div>
                        ))}

                        {/* Rows */}
                        {Array.from({ length: BOARD_SIZE }, (_, y) => (
                            <React.Fragment key={y}>
                                <div className="grid-header">{rowLabels[y]}</div>
                                {Array.from({ length: BOARD_SIZE }, (_, x) => {
                                    const cell = board[y][x];
                                    const hover = getHoverCell(x, y);
                                    let className = 'grid-cell';

                                    if (cell === 'ship') className += ' ship';
                                    if (hover) {
                                        className += hover.valid ? ' ship-preview' : ' ship-invalid';
                                        className += ' clickable';
                                    } else if (selectedShip && !isShipPlaced(selectedShip.id)) {
                                        className += ' clickable';
                                    }

                                    return (
                                        <div
                                            key={x}
                                            className={className}
                                            onClick={() => handleCellClick(x, y)}
                                            onMouseEnter={() => handleCellHover(x, y)}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                toggleOrientation();
                                            }}
                                        />
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Ship List & Controls */}
                <div className="placement-controls">
                    <h3>Fleet</h3>
                    <div className="ship-list">
                        {SHIPS.map((ship) => {
                            const placed = isShipPlaced(ship.id);
                            return (
                                <div
                                    key={ship.id}
                                    className={`ship-item ${selectedShip?.id === ship.id ? 'selected' : ''
                                        } ${placed ? 'placed' : ''}`}
                                    onClick={() => {
                                        if (placed) {
                                            handleRemoveShip(ship.id);
                                        } else {
                                            setSelectedShip(ship);
                                        }
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: '1.3rem' }}>{ship.icon}</span>
                                        <div>
                                            <div className="ship-name">{ship.name}</div>
                                            <div className="ship-size">{ship.size} cells</div>
                                        </div>
                                    </div>
                                    <div className="ship-cells">
                                        {Array.from({ length: ship.size }, (_, i) => (
                                            <div
                                                key={i}
                                                className="ship-cell-preview"
                                                style={{ background: ship.color }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            className="btn btn-secondary"
                            onClick={toggleOrientation}
                            title="Toggle ship orientation"
                            style={{ flex: 1 }}
                        >
                            {horizontal ? '↔ Horiz' : '↕ Vert'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={handleReset}
                            style={{ flex: 1 }}
                        >
                            ↩ Reset
                        </button>
                    </div>

                    <button className="btn btn-secondary" onClick={handleRandom}>
                        🎲 Random Placement
                    </button>

                    <button
                        className="btn btn-primary"
                        disabled={!allShipsPlaced || isCommitting}
                        onClick={() => onCommit(board)}
                    >
                        {isCommitting ? (
                            <>
                                <span className="proof-spinner" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} />
                                Committing...
                            </>
                        ) : (
                            '🔒 Commit Fleet On-Chain'
                        )}
                    </button>
                </div>
            </div>
        </>
    );
}
