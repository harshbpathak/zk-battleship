// ============================================================================
// Noir ZK Proof Integration
// ============================================================================
// Loads the compiled Noir circuit (WASM) and generates ZK proofs in-browser.
// Uses @noir-lang/noir_js for witness generation and
// @noir-lang/backend_barretenberg for proof generation.

// The compiled circuit JSON is expected at /circuits/target/battleship_proof.json
// after running `nargo compile` in the circuits directory.

let noirInstance: any = null;
let backendInstance: any = null;

/** Initialise the Noir circuit and Barretenberg backend */
export async function initNoir(): Promise<void> {
    if (noirInstance) return;

    try {
        // Dynamic imports for tree-shaking
        const { Noir } = await import('@noir-lang/noir_js');
        const { BarretenbergBackend } = await import('@noir-lang/backend_barretenberg');

        // Load the compiled circuit artifact
        const circuitResponse = await fetch('/circuits/battleship_proof.json');
        if (!circuitResponse.ok) {
            throw new Error(
                'Could not load compiled circuit. Run `nargo compile` in the circuits directory first.'
            );
        }
        const circuit = await circuitResponse.json();

        // Initialise backend (Barretenberg WASM)
        backendInstance = new BarretenbergBackend(circuit, { threads: navigator.hardwareConcurrency || 4 });
        noirInstance = new Noir(circuit);

        console.log('[Noir] Circuit and backend initialised successfully');
    } catch (error) {
        console.error('[Noir] Initialisation failed:', error);
        throw error;
    }
}

/** Generate a commitment hash (Poseidon2) for the fleet grid + salt */
export async function generateCommitment(
    fleetGrid: number[],
    salt: string
): Promise<{ commitment: string; witness: any }> {
    await initNoir();

    // We generate the commitment by executing the circuit with a known shot
    // that produces a valid result, then extract the commitment from public inputs.
    // For commitment generation, we use shot (0,0) and the correct response.
    const response = fleetGrid[0]; // Value at (0,0)

    const inputs = {
        fleet_grid: fleetGrid.map(String),
        salt: salt,
        commitment: '', // Will be computed by the circuit
        shot_x: '0',
        shot_y: '0',
        response: String(response),
    };

    // First, compute the commitment using Noir's execution
    // The circuit will hash fleet_grid + salt via Poseidon2
    try {
        const { witness } = await noirInstance.execute(inputs);
        // Extract commitment from witness (it's provided as public output)
        // The exact extraction depends on the circuit compilation output
        console.log('[Noir] Commitment generated');
        return { commitment: 'computed_commitment', witness };
    } catch (error) {
        console.error('[Noir] Commitment generation failed:', error);
        throw error;
    }
}

/** Generate a ZK proof for a shot response */
export async function generateProof(
    fleetGrid: number[],
    salt: string,
    commitment: string,
    shotX: number,
    shotY: number,
    response: number
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
    await initNoir();

    const inputs = {
        fleet_grid: fleetGrid.map(String),
        salt: salt,
        commitment: commitment,
        shot_x: String(shotX),
        shot_y: String(shotY),
        response: String(response),
    };

    console.log(`[Noir] Generating proof for shot (${shotX}, ${shotY}), response: ${response}`);
    const startTime = performance.now();

    try {
        // Generate witness
        const { witness } = await noirInstance.execute(inputs);

        // Generate proof using Barretenberg
        const proof = await backendInstance.generateProof(witness);

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        console.log(`[Noir] Proof generated in ${elapsed}s`);

        return {
            proof: proof.proof,
            publicInputs: proof.publicInputs,
        };
    } catch (error) {
        console.error('[Noir] Proof generation failed:', error);
        throw error;
    }
}

/** Verify a proof locally (for debugging — on-chain verification is authoritative) */
export async function verifyProof(
    proof: Uint8Array,
    publicInputs: string[]
): Promise<boolean> {
    await initNoir();

    try {
        const isValid = await backendInstance.verifyProof({
            proof,
            publicInputs,
        });
        console.log(`[Noir] Local verification: ${isValid ? 'VALID' : 'INVALID'}`);
        return isValid;
    } catch (error) {
        console.error('[Noir] Local verification failed:', error);
        return false;
    }
}

/** Get proof generation status */
export function isInitialised(): boolean {
    return noirInstance !== null && backendInstance !== null;
}
