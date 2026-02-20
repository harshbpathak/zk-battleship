// ============================================================================
// Stellar SDK Wrapper
// ============================================================================
// Handles wallet connection, transaction building, and contract invocation
// via the Freighter browser extension on Stellar Testnet.

const TESTNET_URL = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const HUB_CONTRACT = 'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG';

/** Check if Freighter wallet extension is available */
export function isFreighterInstalled(): boolean {
    return typeof window !== 'undefined' && !!(window as any).freighterApi;
}

/** Connect to Freighter wallet and get the public key.
 *  Falls back to demo mode with a mock address when Freighter is not installed. */
export async function connectWallet(): Promise<string> {
    const freighter = (window as any).freighterApi;

    // Demo mode: generate a mock Stellar address when Freighter is absent
    if (!freighter) {
        console.log('[Stellar] Freighter not detected — entering Demo Mode');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let addr = 'G';
        for (let i = 0; i < 55; i++) addr += chars[Math.floor(Math.random() * chars.length)];
        return addr;
    }

    const response = await freighter.requestAccess();
    if (response.error) {
        throw new Error(`Wallet connection failed: ${response.error}`);
    }

    const addressResponse = await freighter.getAddress();
    if (addressResponse.error) {
        throw new Error(`Could not get address: ${addressResponse.error}`);
    }

    return addressResponse.address;
}

/** Get the current network the wallet is connected to */
export async function getNetwork(): Promise<string> {
    const freighter = (window as any).freighterApi;
    if (!freighter) throw new Error('Freighter not installed');
    const networkResponse = await freighter.getNetwork();
    return networkResponse.network || 'TESTNET';
}

/** Sign and submit a transaction via Freighter */
export async function signAndSubmit(xdr: string): Promise<string> {
    const freighter = (window as any).freighterApi;
    if (!freighter) throw new Error('Freighter not installed');

    const result = await freighter.signTransaction(xdr, {
        networkPassphrase: TESTNET_PASSPHRASE,
    });

    if (result.error) {
        throw new Error(`Transaction signing failed: ${result.error}`);
    }

    return result.signedTxXdr;
}

// ============================================================================
// Contract Invocation Helpers
// ============================================================================
// These functions build and submit transactions to the Battleship smart contract.
// In production, they use the @stellar/stellar-sdk to construct Soroban invocations.

export interface ContractConfig {
    contractAddress: string;
    playerAddress: string;
}

/** Commit fleet hash to the smart contract */
export async function commitFleet(
    _config: ContractConfig,
    _commitmentHash: Uint8Array
): Promise<string> {
    // TODO: Build Soroban invocation for commit_fleet(player, commitment_hash)
    // using @stellar/stellar-sdk SorobanRpc and Contract classes.
    //
    // const server = new SorobanRpc.Server(TESTNET_URL);
    // const contract = new Contract(config.contractAddress);
    // const tx = new TransactionBuilder(...)
    //   .addOperation(contract.call('commit_fleet', ...args))
    //   .build();
    // const prepared = await server.prepareTransaction(tx);
    // const signed = await signAndSubmit(prepared.toXDR());
    // return await server.sendTransaction(signed);

    console.log('[Stellar] commitFleet called');
    return 'mock_tx_hash_commit';
}

/** Fire a shot at the opponent's board */
export async function fireShot(
    _config: ContractConfig,
    _x: number,
    _y: number
): Promise<string> {
    // TODO: Build Soroban invocation for fire_shot(attacker, x, y)
    console.log(`[Stellar] fireShot called at (${_x}, ${_y})`);
    return 'mock_tx_hash_fire';
}

/** Submit a ZK proof response for a pending shot */
export async function submitResponse(
    _config: ContractConfig,
    _response: number,
    _proof: Uint8Array
): Promise<{ txHash: string; isHit: boolean }> {
    // TODO: Build Soroban invocation for submit_response(defender, response, proof)
    console.log('[Stellar] submitResponse called');
    return { txHash: 'mock_tx_hash_response', isHit: _response === 1 };
}

/** Poll on-chain game state */
export async function pollGameState(_contractAddress: string): Promise<any> {
    // TODO: Query contract view functions via Soroban RPC
    // get_phase(), get_pending_shot(), get_hits_received(), etc.
    console.log('[Stellar] pollGameState called');
    return null;
}

/** Claim victory */
export async function claimVictory(
    _config: ContractConfig
): Promise<string> {
    // TODO: Build Soroban invocation for claim_victory(player)
    console.log('[Stellar] claimVictory called');
    return 'mock_tx_hash_victory';
}

export { TESTNET_URL, TESTNET_PASSPHRASE, HUB_CONTRACT };
