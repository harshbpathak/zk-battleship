// ============================================================================
// Game State Types & Logic
// ============================================================================

/** Standard Battleship ship definitions */
export interface ShipDef {
    id: string;
    name: string;
    size: number;
    color: string;
    icon: string;
}

export const SHIPS: ShipDef[] = [
    { id: 'carrier', name: 'Carrier', size: 5, color: '#00e5ff', icon: '🚢' },
    { id: 'battleship', name: 'Battleship', size: 4, color: '#3d7aed', icon: '⚓' },
    { id: 'cruiser', name: 'Cruiser', size: 3, color: '#8b5cf6', icon: '🛥️' },
    { id: 'submarine', name: 'Submarine', size: 3, color: '#22d3a7', icon: '🐟' },
    { id: 'destroyer', name: 'Destroyer', size: 2, color: '#ff9f43', icon: '💣' },
];

export const BOARD_SIZE = 10;
export const TOTAL_SHIP_CELLS = 17; // 5+4+3+3+2

/** Cell states for the grid */
export type CellState = 'empty' | 'ship' | 'hit' | 'miss' | 'sunk';

/** Placed ship on the board */
export interface PlacedShip {
    shipId: string;
    startX: number;
    startY: number;
    horizontal: boolean;
}

/** Shot record */
export interface Shot {
    x: number;
    y: number;
    isHit: boolean;
}

/** Game phases */
export type GamePhase =
    | 'connecting'       // Wallet not connected
    | 'waiting_opponent' // Waiting for opponent to join
    | 'placing'          // Ship placement phase
    | 'committing'       // Submitting fleet commitment
    | 'waiting_commits'  // Waiting for opponent to commit
    | 'your_turn'        // Your turn to fire a shot
    | 'opponent_turn'    // Opponent's turn
    | 'proving'          // Generating ZK proof for a response
    | 'waiting_proof'    // Waiting for opponent's proof
    | 'game_over';       // Game finished

/** Full game state */
export interface GameState {
    phase: GamePhase;
    playerAddress: string | null;
    opponentAddress: string | null;
    sessionId: number | null;
    contractAddress: string | null;

    // Board data
    myBoard: CellState[][];    // 10x10: my ship placements + hits I received
    opponentBoard: CellState[][]; // 10x10: tracking hits/misses on opponent

    // Ship placement
    placedShips: PlacedShip[];
    fleetGrid: number[];       // Flat 100-element array (0/1) for ZK circuit
    salt: string | null;       // Random nonce for commitment
    commitment: string | null; // Poseidon2 hash

    // Combat
    myShots: Shot[];
    opponentShots: Shot[];
    myHitsReceived: number;
    opponentHitsReceived: number;

    // Result
    winner: string | null;
    isWinner: boolean | null;
}

/** Create initial empty game state */
export function createInitialState(): GameState {
    return {
        phase: 'connecting',
        playerAddress: null,
        opponentAddress: null,
        sessionId: null,
        contractAddress: null,
        myBoard: createEmptyBoard(),
        opponentBoard: createEmptyBoard(),
        placedShips: [],
        fleetGrid: new Array(100).fill(0),
        salt: null,
        commitment: null,
        myShots: [],
        opponentShots: [],
        myHitsReceived: 0,
        opponentHitsReceived: 0,
        winner: null,
        isWinner: null,
    };
}

/** Create a 10x10 empty board */
export function createEmptyBoard(): CellState[][] {
    return Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => 'empty' as CellState)
    );
}

/** Check if a ship can be placed at the given position */
export function canPlaceShip(
    board: CellState[][],
    ship: ShipDef,
    startX: number,
    startY: number,
    horizontal: boolean
): boolean {
    for (let i = 0; i < ship.size; i++) {
        const x = horizontal ? startX + i : startX;
        const y = horizontal ? startY : startY + i;

        // Bounds check
        if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
        // Collision check
        if (board[y][x] !== 'empty') return false;
    }
    return true;
}

/** Place a ship on the board (mutates board) */
export function placeShipOnBoard(
    board: CellState[][],
    ship: ShipDef,
    startX: number,
    startY: number,
    horizontal: boolean
): void {
    for (let i = 0; i < ship.size; i++) {
        const x = horizontal ? startX + i : startX;
        const y = horizontal ? startY : startY + i;
        board[y][x] = 'ship';
    }
}

/** Remove a ship from the board (mutates board) */
export function removeShipFromBoard(
    board: CellState[][],
    ship: ShipDef,
    placement: PlacedShip
): void {
    for (let i = 0; i < ship.size; i++) {
        const x = placement.horizontal ? placement.startX + i : placement.startX;
        const y = placement.horizontal ? placement.startY : placement.startY + i;
        board[y][x] = 'empty';
    }
}

/** Convert board to flat 100-element grid for ZK circuit */
export function boardToFleetGrid(board: CellState[][]): number[] {
    const grid: number[] = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            grid.push(board[y][x] === 'ship' ? 1 : 0);
        }
    }
    return grid;
}

/** Generate a random 256-bit salt as hex string */
export function generateSalt(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Format address for display (first 4 + last 4 chars) */
export function formatAddress(address: string): string {
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
