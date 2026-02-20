#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, BytesN, Env, log, Vec,
};

// ============================================================================
// Game Hub Client Interface
// ============================================================================
// The hub contract at CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG
// standardises game lifecycle across all Stellar Game Studio games.

#[soroban_sdk::contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Data Types
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GameError {
    /// Game not found or not initialised
    NotInitialized = 1,
    /// Action not allowed in current game phase
    InvalidPhase = 2,
    /// Caller is not a participant in this game
    NotAPlayer = 3,
    /// Not this player's turn
    NotYourTurn = 4,
    /// Fleet already committed by this player
    AlreadyCommitted = 5,
    /// Shot coordinates out of bounds (must be 0-9)
    OutOfBounds = 6,
    /// Coordinate already targeted
    AlreadyShot = 7,
    /// ZK proof verification failed
    ProofInvalid = 8,
    /// Game already finished
    GameOver = 9,
    /// Invalid response value (must be 0 or 1)
    InvalidResponse = 10,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GamePhase {
    /// Waiting for both players to commit their fleet hashes
    WaitingForCommits,
    /// Player 1's turn to fire a shot
    Player1Turn,
    /// Player 2's turn to fire a shot
    Player2Turn,
    /// Waiting for the defender to submit a ZK proof response
    WaitingForProof,
    /// Game is over, winner determined
    Finished,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingShot {
    pub attacker: Address,
    pub defender: Address,
    pub x: u32,
    pub y: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShotRecord {
    pub x: u32,
    pub y: u32,
    pub is_hit: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerState {
    /// Poseidon2 hash commitment of fleet_grid + salt
    pub commitment: BytesN<32>,
    /// Whether this player has committed their fleet
    pub committed: bool,
    /// Number of ship cells hit (out of 17 total)
    pub hits_received: u32,
    /// Bitmap of cells that have been shot at (for duplicate detection)
    pub shot_mask: Vec<bool>,
    /// History of shots taken against this player
    pub shot_history: Vec<ShotRecord>,
}

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Hub contract address
    HubAddress,
    /// Game session ID on the hub
    SessionId,
    /// Current game phase
    Phase,
    /// Player 1 address
    Player1,
    /// Player 2 address
    Player2,
    /// Player state for a given address
    PlayerState(Address),
    /// Currently pending shot awaiting proof
    PendingShot,
    /// Address of the winner
    Winner,
}

// ============================================================================
// Contract Implementation
// ============================================================================

#[contract]
pub struct BattleshipContract;

#[contractimpl]
impl BattleshipContract {
    // ========================================================================
    // Initialisation
    // ========================================================================

    /// Initialise a new game session between two players.
    /// Calls `start_game()` on the hub contract to register the session.
    pub fn initialize(
        env: Env,
        hub_address: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
    ) -> Result<(), GameError> {
        // Store configuration
        env.storage().temporary().set(&DataKey::HubAddress, &hub_address);
        env.storage().temporary().set(&DataKey::SessionId, &session_id);
        env.storage().temporary().set(&DataKey::Player1, &player1);
        env.storage().temporary().set(&DataKey::Player2, &player2);
        env.storage().temporary().set(&DataKey::Phase, &GamePhase::WaitingForCommits);

        // Initialise empty player states
        let empty_mask = Vec::from_array(&env, &[false; 100]);

        let p1_state = PlayerState {
            commitment: BytesN::from_array(&env, &[0u8; 32]),
            committed: false,
            hits_received: 0,
            shot_mask: empty_mask.clone(),
            shot_history: Vec::new(&env),
        };

        let p2_state = PlayerState {
            commitment: BytesN::from_array(&env, &[0u8; 32]),
            committed: false,
            hits_received: 0,
            shot_mask: empty_mask,
            shot_history: Vec::new(&env),
        };

        env.storage().temporary().set(&DataKey::PlayerState(player1.clone()), &p1_state);
        env.storage().temporary().set(&DataKey::PlayerState(player2.clone()), &p2_state);

        // Register game on the hub
        let hub_client = GameHubClient::new(&env, &hub_address);
        let game_id = env.current_contract_address();
        hub_client.start_game(
            &game_id,
            &session_id,
            &player1,
            &player2,
            &0_i128,
            &0_i128,
        );

        log!(&env, "Game initialized: session {}", session_id);
        env.events().publish(
            (symbol_short!("init"),),
            (player1, player2, session_id),
        );

        // Extend TTL to 30 days (approx 2,592,000 ledgers at 1 ledger/sec)
        Self::extend_ttl(&env);

        Ok(())
    }

    // ========================================================================
    // Fleet Commitment
    // ========================================================================

    /// Commit a fleet hash on-chain. Both players must commit before gameplay begins.
    /// The commitment is Poseidon2(fleet_grid || salt), computed client-side.
    pub fn commit_fleet(
        env: Env,
        player: Address,
        commitment_hash: BytesN<32>,
    ) -> Result<(), GameError> {
        player.require_auth();

        let phase: GamePhase = env.storage().temporary().get(&DataKey::Phase)
            .ok_or(GameError::NotInitialized)?;

        if phase != GamePhase::WaitingForCommits {
            return Err(GameError::InvalidPhase);
        }

        Self::require_player(&env, &player)?;

        let mut state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(player.clone()))
            .ok_or(GameError::NotInitialized)?;

        if state.committed {
            return Err(GameError::AlreadyCommitted);
        }

        state.commitment = commitment_hash;
        state.committed = true;
        env.storage().temporary().set(&DataKey::PlayerState(player.clone()), &state);

        log!(&env, "Fleet committed by player");
        env.events().publish(
            (symbol_short!("commit"),),
            player.clone(),
        );

        // Check if both players have committed
        let p1: Address = env.storage().temporary().get(&DataKey::Player1).unwrap();
        let p2: Address = env.storage().temporary().get(&DataKey::Player2).unwrap();
        let p1_state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(p1)).unwrap();
        let p2_state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(p2)).unwrap();

        if p1_state.committed && p2_state.committed {
            env.storage().temporary().set(&DataKey::Phase, &GamePhase::Player1Turn);
            env.events().publish(
                (symbol_short!("start"),),
                true,
            );
        }

        Ok(())
    }

    // ========================================================================
    // Shot Firing
    // ========================================================================

    /// Fire a shot at the opponent's board. Records the shot and moves to WaitingForProof.
    pub fn fire_shot(
        env: Env,
        attacker: Address,
        x: u32,
        y: u32,
    ) -> Result<(), GameError> {
        attacker.require_auth();

        let phase: GamePhase = env.storage().temporary().get(&DataKey::Phase)
            .ok_or(GameError::NotInitialized)?;

        // Determine who should be attacking
        let p1: Address = env.storage().temporary().get(&DataKey::Player1).unwrap();
        let p2: Address = env.storage().temporary().get(&DataKey::Player2).unwrap();

        match &phase {
            GamePhase::Player1Turn => {
                if attacker != p1 {
                    return Err(GameError::NotYourTurn);
                }
            }
            GamePhase::Player2Turn => {
                if attacker != p2 {
                    return Err(GameError::NotYourTurn);
                }
            }
            _ => return Err(GameError::InvalidPhase),
        }

        // Bounds check
        if x >= 10 || y >= 10 {
            return Err(GameError::OutOfBounds);
        }

        // Determine defender
        let defender = if attacker == p1 { p2.clone() } else { p1.clone() };

        // Check if coordinate already targeted
        let defender_state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(defender.clone()))
            .unwrap();
        let index = (x * 10 + y) as u32;
        if defender_state.shot_mask.get(index).unwrap_or(false) {
            return Err(GameError::AlreadyShot);
        }

        // Record pending shot
        let pending = PendingShot {
            attacker: attacker.clone(),
            defender: defender.clone(),
            x,
            y,
        };
        env.storage().temporary().set(&DataKey::PendingShot, &pending);
        env.storage().temporary().set(&DataKey::Phase, &GamePhase::WaitingForProof);

        log!(&env, "Shot fired at ({}, {})", x, y);
        env.events().publish(
            (symbol_short!("fire"),),
            (attacker, x, y),
        );

        Ok(())
    }

    // ========================================================================
    // Shot Response with ZK Proof
    // ========================================================================

    /// Submit a ZK proof response for a pending shot.
    /// The proof is verified on-chain using Protocol 25's BN254 host function.
    pub fn submit_response(
        env: Env,
        defender: Address,
        response: u32,
        proof: BytesN<256>,
    ) -> Result<bool, GameError> {
        defender.require_auth();

        let phase: GamePhase = env.storage().temporary().get(&DataKey::Phase)
            .ok_or(GameError::NotInitialized)?;

        if phase != GamePhase::WaitingForProof {
            return Err(GameError::InvalidPhase);
        }

        let pending: PendingShot = env.storage().temporary()
            .get(&DataKey::PendingShot)
            .ok_or(GameError::NotInitialized)?;

        if defender != pending.defender {
            return Err(GameError::NotYourTurn);
        }

        if response > 1 {
            return Err(GameError::InvalidResponse);
        }

        let is_hit = response == 1;

        // ====================================================================
        // ZK Proof Verification
        // ====================================================================
        // In production, this calls the BN254 pairing check host function
        // from Stellar Protocol 25. The proof contains:
        //   - Verification that Poseidon2(fleet_grid, salt) == commitment
        //   - Verification that fleet_grid[x * 10 + y] == response
        //
        // For the hackathon MVP, we verify the proof structure is non-empty.
        // The actual BN254 verification will be integrated once Protocol 25
        // host functions are available on Testnet.
        //
        // TODO: Replace with actual BN254 verifier call:
        // env.crypto().bls12_381().pairing_check(...)
        // or the equivalent BN254 host function when available

        let proof_valid = Self::verify_zk_proof(&env, &proof, &pending, response);
        if !proof_valid {
            return Err(GameError::ProofInvalid);
        }

        // ====================================================================
        // Update Board State
        // ====================================================================
        let mut defender_state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(defender.clone()))
            .unwrap();

        // Mark cell as shot
        let index = (pending.x * 10 + pending.y) as u32;
        defender_state.shot_mask.set(index, true);

        // Record in shot history
        let record = ShotRecord {
            x: pending.x,
            y: pending.y,
            is_hit,
        };
        defender_state.shot_history.push_back(record);

        // Update hit count
        if is_hit {
            defender_state.hits_received += 1;
        }

        env.storage().temporary().set(&DataKey::PlayerState(defender.clone()), &defender_state);

        // Clear pending shot
        env.storage().temporary().remove(&DataKey::PendingShot);

        log!(&env, "Response: {} at ({}, {})", if is_hit { "HIT" } else { "MISS" }, pending.x, pending.y);
        env.events().publish(
            (symbol_short!("respond"),),
            (defender.clone(), pending.x, pending.y, is_hit),
        );

        // Check for victory (all 17 ship cells hit)
        if defender_state.hits_received >= 17 {
            return Self::declare_winner(&env, &pending.attacker);
        }

        // Switch turns: defender becomes the next attacker
        let p1: Address = env.storage().temporary().get(&DataKey::Player1).unwrap();
        if defender == p1 {
            env.storage().temporary().set(&DataKey::Phase, &GamePhase::Player1Turn);
        } else {
            env.storage().temporary().set(&DataKey::Phase, &GamePhase::Player2Turn);
        }

        Ok(is_hit)
    }

    // ========================================================================
    // Victory Claim
    // ========================================================================

    /// Explicitly claim victory. Called when all 17 of opponent's ship cells are hit.
    pub fn claim_victory(env: Env, player: Address) -> Result<(), GameError> {
        player.require_auth();
        Self::require_player(&env, &player)?;

        let phase: GamePhase = env.storage().temporary().get(&DataKey::Phase)
            .ok_or(GameError::NotInitialized)?;

        if phase == GamePhase::Finished {
            return Err(GameError::GameOver);
        }

        // Check opponent's hit count
        let p1: Address = env.storage().temporary().get(&DataKey::Player1).unwrap();
        let p2: Address = env.storage().temporary().get(&DataKey::Player2).unwrap();
        let opponent = if player == p1 { p2 } else { p1 };

        let opponent_state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(opponent))
            .unwrap();

        if opponent_state.hits_received < 17 {
            return Err(GameError::InvalidPhase);
        }

        Self::declare_winner(&env, &player)?;
        Ok(())
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    /// Get the current game phase.
    pub fn get_phase(env: Env) -> Result<GamePhase, GameError> {
        env.storage().temporary().get(&DataKey::Phase)
            .ok_or(GameError::NotInitialized)
    }

    /// Get both player addresses.
    pub fn get_players(env: Env) -> Result<(Address, Address), GameError> {
        let p1: Address = env.storage().temporary().get(&DataKey::Player1)
            .ok_or(GameError::NotInitialized)?;
        let p2: Address = env.storage().temporary().get(&DataKey::Player2)
            .ok_or(GameError::NotInitialized)?;
        Ok((p1, p2))
    }

    /// Get a player's commitment status.
    pub fn get_commitment_status(env: Env, player: Address) -> Result<bool, GameError> {
        let state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(player))
            .ok_or(GameError::NotInitialized)?;
        Ok(state.committed)
    }

    /// Get the number of hits a player has received.
    pub fn get_hits_received(env: Env, player: Address) -> Result<u32, GameError> {
        let state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(player))
            .ok_or(GameError::NotInitialized)?;
        Ok(state.hits_received)
    }

    /// Get the shot history for a player (shots received).
    pub fn get_shot_history(env: Env, player: Address) -> Result<Vec<ShotRecord>, GameError> {
        let state: PlayerState = env.storage().temporary()
            .get(&DataKey::PlayerState(player))
            .ok_or(GameError::NotInitialized)?;
        Ok(state.shot_history)
    }

    /// Get the pending shot awaiting a proof response, if any.
    pub fn get_pending_shot(env: Env) -> Option<PendingShot> {
        env.storage().temporary().get(&DataKey::PendingShot)
    }

    /// Get the winner's address (only available after game ends).
    pub fn get_winner(env: Env) -> Option<Address> {
        env.storage().temporary().get(&DataKey::Winner)
    }

    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /// Verify the caller is a registered player.
    fn require_player(env: &Env, player: &Address) -> Result<(), GameError> {
        let p1: Address = env.storage().temporary().get(&DataKey::Player1)
            .ok_or(GameError::NotInitialized)?;
        let p2: Address = env.storage().temporary().get(&DataKey::Player2)
            .ok_or(GameError::NotInitialized)?;
        if player != &p1 && player != &p2 {
            return Err(GameError::NotAPlayer);
        }
        Ok(())
    }

    /// Verify a ZK proof against the pending shot.
    /// TODO: Integrate actual BN254 pairing check from Protocol 25 host functions.
    fn verify_zk_proof(
        _env: &Env,
        proof: &BytesN<256>,
        _pending: &PendingShot,
        _response: u32,
    ) -> bool {
        // ================================================================
        // PLACEHOLDER: Protocol 25 BN254 Verification
        // ================================================================
        // When Stellar's Protocol 25 BN254 host functions are available,
        // this will perform an on-chain pairing check to verify the Noir
        // proof against the verification key compiled from the circuit.
        //
        // The verification will check:
        //   1. The proof is valid for the given public inputs
        //   2. Public inputs include: commitment, shot_x, shot_y, response
        //   3. The verification key matches our compiled circuit
        //
        // For now, we check that the proof bytes are non-zero (not empty).
        let zero_proof = BytesN::from_array(_env, &[0u8; 256]);
        proof != &zero_proof
    }

    /// Declare a winner and finalize the game on the hub.
    fn declare_winner(env: &Env, winner: &Address) -> Result<bool, GameError> {
        env.storage().temporary().set(&DataKey::Phase, &GamePhase::Finished);
        env.storage().temporary().set(&DataKey::Winner, winner);

        // Notify hub contract
        let hub_address: Address = env.storage().temporary()
            .get(&DataKey::HubAddress)
            .ok_or(GameError::NotInitialized)?;
        let session_id: u32 = env.storage().temporary()
            .get(&DataKey::SessionId)
            .ok_or(GameError::NotInitialized)?;

        let p1: Address = env.storage().temporary().get(&DataKey::Player1).unwrap();
        let player1_won = winner == &p1;

        let hub_client = GameHubClient::new(env, &hub_address);
        hub_client.end_game(&session_id, &player1_won);

        log!(env, "Game over! Winner declared");
        env.events().publish(
            (symbol_short!("winner"),),
            winner.clone(),
        );

        Ok(true)
    }

    /// Extend storage TTL to approximately 30 days.
    fn extend_ttl(env: &Env) {
        let thirty_days: u32 = 30 * 24 * 60 * 60; // ~2,592,000 ledgers
        env.storage().temporary().extend_ttl(&DataKey::Phase, thirty_days, thirty_days);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::{vec, Env, IntoVal};

    fn setup_game(env: &Env) -> (Address, Address, Address, BattleshipContractClient<'_>) {
        let contract_id = env.register(BattleshipContract, ());
        let client = BattleshipContractClient::new(env, &contract_id);

        let player1 = Address::generate(env);
        let player2 = Address::generate(env);

        // For testing, we use a mock hub address
        let hub = Address::generate(env);

        (player1, player2, hub, client)
    }

    #[test]
    fn test_commit_fleet() {
        let env = Env::default();
        env.mock_all_auths();

        let (p1, p2, hub, client) = setup_game(&env);

        // Note: initialize would fail without a real hub contract,
        // so we test commit_fleet logic in isolation by setting up state manually
        env.as_contract(&client.address, || {
            env.storage().temporary().set(&DataKey::Phase, &GamePhase::WaitingForCommits);
            env.storage().temporary().set(&DataKey::Player1, &p1);
            env.storage().temporary().set(&DataKey::Player2, &p2);

            let empty_mask = Vec::from_array(&env, &[false; 100]);
            let state = PlayerState {
                commitment: BytesN::from_array(&env, &[0u8; 32]),
                committed: false,
                hits_received: 0,
                shot_mask: empty_mask.clone(),
                shot_history: Vec::new(&env),
            };
            env.storage().temporary().set(&DataKey::PlayerState(p1.clone()), &state);
            env.storage().temporary().set(&DataKey::PlayerState(p2.clone()), &state.clone());
        });

        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        let result = client.commit_fleet(&p1, &commitment);
        assert_eq!(result, ());

        // Verify player 1 is committed but game hasn't started (p2 not committed)
        assert_eq!(client.get_commitment_status(&p1), true);
        assert_eq!(client.get_commitment_status(&p2), false);
        assert_eq!(client.get_phase(), GamePhase::WaitingForCommits);
    }

    #[test]
    fn test_fire_shot() {
        let env = Env::default();
        env.mock_all_auths();

        let (p1, p2, _hub, client) = setup_game(&env);

        // Set up game in Player1Turn phase
        env.as_contract(&client.address, || {
            env.storage().temporary().set(&DataKey::Phase, &GamePhase::Player1Turn);
            env.storage().temporary().set(&DataKey::Player1, &p1);
            env.storage().temporary().set(&DataKey::Player2, &p2);

            let empty_mask = Vec::from_array(&env, &[false; 100]);
            let state = PlayerState {
                commitment: BytesN::from_array(&env, &[1u8; 32]),
                committed: true,
                hits_received: 0,
                shot_mask: empty_mask,
                shot_history: Vec::new(&env),
            };
            env.storage().temporary().set(&DataKey::PlayerState(p1.clone()), &state);
            env.storage().temporary().set(&DataKey::PlayerState(p2.clone()), &state.clone());
        });

        // Player 1 fires at (3, 4)
        client.fire_shot(&p1, &3, &4);

        // Should now be waiting for proof
        assert_eq!(client.get_phase(), GamePhase::WaitingForProof);

        let pending = client.get_pending_shot();
        assert!(pending.is_some());
        let shot = pending.unwrap();
        assert_eq!(shot.x, 3);
        assert_eq!(shot.y, 4);
    }
}
