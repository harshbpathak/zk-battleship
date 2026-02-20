# ⚓ ZK Battleship

**Fully trustless, on-chain Battleship powered by Zero-Knowledge proofs on Stellar.**

[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Noir](https://img.shields.io/badge/Noir-ZK%20Circuit-purple)](https://noir-lang.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

> Built for the **Stellar ZK Gaming Hackathon** — demonstrating production-ready ZK gaming primitives on Stellar Protocol 25.

---

##  What is ZK Battleship?

ZK Battleship is a two-player implementation of the classic Battleship game where **Zero-Knowledge proofs replace the need for a trusted referee**. Every hit/miss response is cryptographically proven, making cheating **mathematically impossible**.

### Why ZK?

Without ZK, a player can claim "miss" when they actually got "hit" — and there's no way to disprove this without revealing their fleet (which ends the game). ZK proofs solve this perfectly:

```
PRIVATE inputs: fleet_positions, salt
PUBLIC  inputs: commitment_hash, shot_coordinate, response
PROOF:  "Given this commitment, the response to the query is provably correct"
```

---

##  Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  Wallet Connect │ Fleet Grid │ Game Board │ Proof UX     │
├──────────────────┬────────────────────────┬──────────────┤
│  Noir WASM       │   Stellar SDK          │  Freighter   │
│  (Proof Gen)     │   (Contract Calls)     │  (Signing)   │
├──────────────────┴────────────────────────┴──────────────┤
│              Soroban Smart Contracts                      │
│  commit_fleet │ fire_shot │ submit_response │ claim_win   │
├──────────────────────────────────────────────┬───────────┤
│         Stellar Testnet (Protocol 25)        │ Hub       │
│         BN254 + Poseidon2 Primitives         │ Contract  │
└──────────────────────────────────────────────┴───────────┘
```

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| ZK Circuit | **Noir** | Proves hit/miss without revealing fleet |
| Smart Contracts | **Soroban (Rust)** | Game state, proof verification, hub calls |
| Blockchain | **Stellar Testnet** | Settlement; Protocol 25 BN254/Poseidon |
| Frontend | **React + TypeScript** | Game UI, wallet connect, proof generation |

---

##  Game Flow

1. **Connect** — Both players connect Stellar wallets
2. **Deploy Fleet** — Place 5 ships on a private 10×10 grid
3. **Commit** — Submit `Poseidon2(fleet + salt)` hash on-chain
4. **Battle** — Fire shots; each response includes a ZK proof
5. **Victory** — First to sink all 17 ship cells wins; result on-chain

### Standard Fleet

| Ship | Size |
|------|------|
| Carrier | 5 |
| Battleship | 4 |
| Cruiser | 3 |
| Submarine | 3 |
| Destroyer | 2 |
| **Total** | **17 cells** |

---

##  Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) + [Soroban CLI](https://soroban.stellar.org/docs/getting-started)
- [Nargo](https://noir-lang.org/docs/getting_started/quick_start) (Noir compiler)
- [Node.js 18+](https://nodejs.org/) + npm
- [Freighter Wallet](https://freighter.app/) browser extension

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/zk-battleship.git
cd zk-battleship

# 1. Compile the Noir circuit
cd circuits
nargo compile
nargo test  # Run circuit unit tests
cd ..

# 2. Build and deploy the Soroban contract
cd contracts/battleship
cargo build --release --target wasm32-unknown-unknown
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/battleship.wasm --network testnet
cd ../..

# 3. Start the frontend
cd frontend
npm install
npm run dev   # Opens http://localhost:3000
```

### Hub Contract

The game registers with the official Stellar Game Studio hub contract:
```
CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
```

---

##  ZK Circuit Details

The Noir circuit (`circuits/src/main.nr`) proves for every shot:

```noir
// Constraint 1: Commitment binds the fleet
assert(Poseidon2(fleet_grid || salt) == commitment);

// Constraint 2: Response matches actual grid cell
assert(fleet_grid[shot_x * 10 + shot_y] == response);

// Constraint 3: Fleet is valid (17 ship cells, all 0 or 1)
```

**Private inputs**: `fleet_grid` (100 cells), `salt` (nonce)
**Public inputs**: `commitment`, `shot_x`, `shot_y`, `response`

Proof generation runs **entirely in the browser** via Noir WASM — your fleet data never leaves your device.

---

##  Project Structure

```
zk-battleship/
├── circuits/                    # Noir ZK circuit
│   ├── Nargo.toml              # Noir project config
│   ├── Prover.toml             # Example prover inputs
│   └── src/
│       └── main.nr             # Battleship proof circuit + tests
├── contracts/                   # Soroban smart contracts
│   └── battleship/
│       ├── Cargo.toml          # Rust dependencies
│       └── src/
│           └── lib.rs          # Game contract (commit, fire, verify, win)
├── frontend/                    # React + TypeScript frontend
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx             # Main app with game loop
│       ├── index.css           # Design system (dark naval theme)
│       ├── lib/
│       │   ├── gameState.ts    # Game types & state logic
│       │   ├── stellar.ts     # Stellar SDK / Freighter wrapper
│       │   └── noir.ts        # Noir WASM proof generation
│       └── components/
│           ├── FleetPlacement.tsx   # Ship placement UI
│           ├── GameBoard.tsx        # Dual-board battle view
│           ├── GameOver.tsx         # Win/lose screen
│           └── ProofOverlay.tsx     # Proof generation UX
└── README.md
```

---

##  Links

- **Hackathon**: [Stellar Hacks: ZK Gaming on DoraHacks](https://dorahacks.io)
- **Hub Contract**: `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`
- **Stellar Game Studio**: [GitHub](https://github.com/jamesbachini/Stellar-Game-Studio) | [Live](https://jamesbachini.github.io/Stellar-Game-Studio/)
- **Noir Documentation**: [noir-lang.org](https://noir-lang.org/)
- **Stellar Protocol 25**: [stellar.org/protocol-25](https://stellar.org/protocol-25)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
