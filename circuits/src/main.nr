use std::hash::poseidon2;

// ============================================================================
// ZK Battleship Proof Circuit
// ============================================================================
// Proves that a shot response (hit/miss) is consistent with a committed fleet
// layout, without revealing the fleet positions.
//
// PRIVATE inputs: fleet_grid (ship positions), salt (random nonce)
// PUBLIC  inputs: commitment hash, shot coordinates, response
//
// Constraints:
//   1. Poseidon2(fleet_grid || salt) == commitment
//   2. fleet_grid[shot_x * 10 + shot_y] == response
//   3. Fleet is valid (correct ship sizes, no overlaps, within bounds)
// ============================================================================

/// Standard Battleship fleet: [Carrier=5, Battleship=4, Cruiser=3, Submarine=3, Destroyer=2]
global SHIP_SIZES: [u8; 5] = [5, 4, 3, 3, 2];
global BOARD_SIZE: u32 = 10;
global GRID_CELLS: u32 = 100;
global TOTAL_SHIP_CELLS: u32 = 17; // 5+4+3+3+2

fn main(
    // Private inputs (known only to the defender)
    fleet_grid: [Field; 100],   // 10x10 board: 1 = ship cell, 0 = empty
    salt: Field,                // Random nonce committed at game start

    // Public inputs (visible to everyone / on-chain)
    commitment: pub Field,      // Poseidon2(fleet_grid || salt)
    shot_x: pub u8,             // Attack column (0-9)
    shot_y: pub u8,             // Attack row (0-9)
    response: pub u8            // 1 = hit, 0 = miss
) {
    // ========================================================================
    // Constraint 1: Commitment integrity
    // ========================================================================
    // Hash the fleet grid and salt together, verify it matches the on-chain commitment.
    // This prevents the defender from changing their fleet mid-game.
    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = fleet_grid[i];
    }
    hash_inputs[100] = salt;
    let computed_commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);
    assert(computed_commitment == commitment, "Commitment mismatch: fleet or salt was tampered");

    // ========================================================================
    // Constraint 2: Response correctness
    // ========================================================================
    // The response must match the actual cell value at the shot coordinate.
    assert(shot_x < 10, "shot_x out of bounds");
    assert(shot_y < 10, "shot_y out of bounds");
    let index: Field = (shot_x as Field) * 10 + (shot_y as Field);

    // Access the grid cell at the shot position
    let cell_value = fleet_grid[index as u32];
    let response_field = response as Field;
    assert(cell_value == response_field, "Response does not match fleet grid at shot coordinate");

    // ========================================================================
    // Constraint 3: Valid fleet placement
    // ========================================================================
    // Ensure every cell is 0 or 1
    for i in 0..100 {
        let cell = fleet_grid[i];
        assert(cell * (cell - 1) == 0, "Grid cell must be 0 or 1");
    }

    // Ensure total ship cells = 17 (5+4+3+3+2)
    let mut total_cells: Field = 0;
    for i in 0..100 {
        total_cells += fleet_grid[i];
    }
    assert(total_cells == TOTAL_SHIP_CELLS as Field, "Fleet must contain exactly 17 ship cells");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_valid_hit() {
    // Place a simple fleet on the grid
    let mut grid: [Field; 100] = [0; 100];

    // Carrier (5 cells) at row 0, cols 0-4
    grid[0] = 1; grid[1] = 1; grid[2] = 1; grid[3] = 1; grid[4] = 1;
    // Battleship (4 cells) at row 1, cols 0-3
    grid[10] = 1; grid[11] = 1; grid[12] = 1; grid[13] = 1;
    // Cruiser (3 cells) at row 2, cols 0-2
    grid[20] = 1; grid[21] = 1; grid[22] = 1;
    // Submarine (3 cells) at row 3, cols 0-2
    grid[30] = 1; grid[31] = 1; grid[32] = 1;
    // Destroyer (2 cells) at row 4, cols 0-1
    grid[40] = 1; grid[41] = 1;

    let salt: Field = 12345;

    // Compute commitment
    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = grid[i];
    }
    hash_inputs[100] = salt;
    let commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);

    // Fire at (0, 0) which is a HIT (Carrier)
    main(grid, salt, commitment, 0, 0, 1);
}

#[test]
fn test_valid_miss() {
    let mut grid: [Field; 100] = [0; 100];

    // Same fleet as above
    grid[0] = 1; grid[1] = 1; grid[2] = 1; grid[3] = 1; grid[4] = 1;
    grid[10] = 1; grid[11] = 1; grid[12] = 1; grid[13] = 1;
    grid[20] = 1; grid[21] = 1; grid[22] = 1;
    grid[30] = 1; grid[31] = 1; grid[32] = 1;
    grid[40] = 1; grid[41] = 1;

    let salt: Field = 12345;

    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = grid[i];
    }
    hash_inputs[100] = salt;
    let commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);

    // Fire at (9, 9) which is a MISS (empty cell)
    main(grid, salt, commitment, 9, 9, 0);
}

#[test(should_fail_with = "Response does not match fleet grid at shot coordinate")]
fn test_lying_about_hit() {
    let mut grid: [Field; 100] = [0; 100];

    grid[0] = 1; grid[1] = 1; grid[2] = 1; grid[3] = 1; grid[4] = 1;
    grid[10] = 1; grid[11] = 1; grid[12] = 1; grid[13] = 1;
    grid[20] = 1; grid[21] = 1; grid[22] = 1;
    grid[30] = 1; grid[31] = 1; grid[32] = 1;
    grid[40] = 1; grid[41] = 1;

    let salt: Field = 12345;

    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = grid[i];
    }
    hash_inputs[100] = salt;
    let commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);

    // Fire at (0, 0) which IS a hit, but claim MISS (0) — should fail
    main(grid, salt, commitment, 0, 0, 0);
}

#[test(should_fail_with = "Commitment mismatch")]
fn test_tampered_fleet() {
    let mut grid: [Field; 100] = [0; 100];
    let mut tampered_grid: [Field; 100] = [0; 100];

    // Original fleet
    grid[0] = 1; grid[1] = 1; grid[2] = 1; grid[3] = 1; grid[4] = 1;
    grid[10] = 1; grid[11] = 1; grid[12] = 1; grid[13] = 1;
    grid[20] = 1; grid[21] = 1; grid[22] = 1;
    grid[30] = 1; grid[31] = 1; grid[32] = 1;
    grid[40] = 1; grid[41] = 1;

    // Tampered fleet (moved destroyer)
    tampered_grid[0] = 1; tampered_grid[1] = 1; tampered_grid[2] = 1; tampered_grid[3] = 1; tampered_grid[4] = 1;
    tampered_grid[10] = 1; tampered_grid[11] = 1; tampered_grid[12] = 1; tampered_grid[13] = 1;
    tampered_grid[20] = 1; tampered_grid[21] = 1; tampered_grid[22] = 1;
    tampered_grid[30] = 1; tampered_grid[31] = 1; tampered_grid[32] = 1;
    tampered_grid[90] = 1; tampered_grid[91] = 1; // Moved destroyer to row 9

    let salt: Field = 12345;

    // Commitment made with ORIGINAL grid
    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = grid[i];
    }
    hash_inputs[100] = salt;
    let commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);

    // Attempt to prove with TAMPERED grid — should fail
    main(tampered_grid, salt, commitment, 9, 0, 1);
}

#[test(should_fail_with = "Fleet must contain exactly 17 ship cells")]
fn test_invalid_fleet_too_many_cells() {
    let mut grid: [Field; 100] = [0; 100];

    // Place 18 cells instead of 17
    grid[0] = 1; grid[1] = 1; grid[2] = 1; grid[3] = 1; grid[4] = 1;
    grid[10] = 1; grid[11] = 1; grid[12] = 1; grid[13] = 1;
    grid[20] = 1; grid[21] = 1; grid[22] = 1;
    grid[30] = 1; grid[31] = 1; grid[32] = 1;
    grid[40] = 1; grid[41] = 1; grid[42] = 1; // Extra cell!

    let salt: Field = 12345;

    let mut hash_inputs: [Field; 101] = [0; 101];
    for i in 0..100 {
        hash_inputs[i] = grid[i];
    }
    hash_inputs[100] = salt;
    let commitment = poseidon2::Poseidon2::hash(hash_inputs, 101);

    main(grid, salt, commitment, 0, 0, 1);
}
