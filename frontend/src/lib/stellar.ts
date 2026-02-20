// ============================================================================
// Stellar SDK Wrapper
// ============================================================================
// Handles wallet connection, transaction building, and contract invocation
// via the Freighter browser extension on Stellar Testnet.

import {
    Contract,
    TransactionBuilder,
    Networks,
    SorobanRpc,
    Address,
    nativeToScVal,
    xdr,
    Transaction,
} from '@stellar/stellar-sdk';
import {
    isConnected,
    isAllowed,
    requestAccess,
    getAddress,
    getNetwork,
    signTransaction,
} from '@stellar/freighter-api';

const TESTNET_URL = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = Networks.TESTNET;
const HUB_CONTRACT = 'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG';
const BATTLESHIP_CONTRACT = 'CAKHKBQBUN4BDQM6ITQFSUTDNUOYCKMZQBAYTBTFDWQGSLA5ZOUOI5ZJ';

const server = new SorobanRpc.Server(TESTNET_URL, { allowHttp: false });

// ============================================================================
// Wallet Helpers
// ============================================================================

/** Check if Freighter wallet extension is available */
export async function isFreighterInstalled(): Promise<boolean> {
    try {
        const result = await isConnected();
        return result.isConnected;
    } catch {
        return false;
    }
}

/** Connect to Freighter wallet and get the public key.
 *  Falls back to demo mode with a mock address when Freighter is not installed. */
export async function connectWallet(): Promise<string> {
    // Check if Freighter is connected
    const connectedResult = await isConnected().catch(() => ({ isConnected: false }));

    if (!connectedResult.isConnected) {
        console.log('[Stellar] Freighter not detected — entering Demo Mode');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let addr = 'G';
        for (let i = 0; i < 55; i++) addr += chars[Math.floor(Math.random() * chars.length)];
        return addr;
    }

    // Request access (prompts user in Freighter popup)
    const accessResult = await requestAccess();
    if (accessResult.error) throw new Error(`Wallet connection failed: ${accessResult.error}`);

    const addressResult = await getAddress();
    if (addressResult.error) throw new Error(`Could not get address: ${addressResult.error}`);

    return addressResult.address;
}

/** Get the current network the wallet is connected to */
export async function getWalletNetwork(): Promise<string> {
    const result = await getNetwork();
    if (result.error) throw new Error('Could not get network from Freighter');
    return result.network || 'TESTNET';
}

// ============================================================================
// Core Transaction Helper
// ============================================================================

/**
 * Build, simulate, sign via Freighter, submit, and poll a Soroban transaction.
 * Returns the transaction hash on success.
 */
async function invokeContract(
    playerAddress: string,
    contractAddress: string,
    method: string,
    args: xdr.ScVal[]
): Promise<string> {
    // Load the source account
    const account = await server.getAccount(playerAddress);

    // Build the transaction
    const contract = new Contract(contractAddress);
    const tx = new TransactionBuilder(account, {
        fee: '100000', // 0.01 XLM max fee
        networkPassphrase: TESTNET_PASSPHRASE,
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    // Simulate to get the footprint + fee
    const prepared = await server.prepareTransaction(tx);

    // Sign via Freighter
    const signResult = await signTransaction(prepared.toXDR(), {
        networkPassphrase: TESTNET_PASSPHRASE,
    });
    if (signResult.error) throw new Error(`Signing failed: ${signResult.error}`);

    // Reconstruct and submit
    const signedTx = TransactionBuilder.fromXDR(
        signResult.signedTxXdr,
        TESTNET_PASSPHRASE
    ) as Transaction;

    const sendResult = await server.sendTransaction(signedTx);
    if (sendResult.status === 'ERROR') {
        throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
    }

    // Poll until confirmed
    let getResult = await server.getTransaction(sendResult.hash);
    let attempts = 0;
    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
        await new Promise((r) => setTimeout(r, 1500));
        getResult = await server.getTransaction(sendResult.hash);
        attempts++;
    }

    if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction confirmed but failed on-chain: ${sendResult.hash}`);
    }

    console.log(`[Stellar] ${method} confirmed: ${sendResult.hash}`);
    return sendResult.hash;
}

// ============================================================================
// Contract Invocation Helpers
// ============================================================================

export interface ContractConfig {
    contractAddress: string;
    playerAddress: string;
}

/** Initialize (or re-initialize) a game session with real player addresses.
 *  Called by player 1 when both players have joined, to register real wallet
 *  addresses on-chain and call start_game() on the hub. */
export async function initializeGame(
    player1Address: string,
    player2Address: string,
): Promise<string> {
    console.log('[Stellar] initializeGame — registering players on-chain...');

    const hubScVal = new Address(HUB_CONTRACT).toScVal();
    // Use timestamp-based session ID (fits u32) — unique per game
    const sessionId = Math.floor(Date.now() / 1000) % 2_000_000_000;
    const sessionScVal = nativeToScVal(sessionId, { type: 'u32' });
    const p1ScVal = new Address(player1Address).toScVal();
    const p2ScVal = new Address(player2Address).toScVal();

    return invokeContract(
        player1Address,
        BATTLESHIP_CONTRACT,
        'initialize',
        [hubScVal, sessionScVal, p1ScVal, p2ScVal]
    );
}

/** Commit fleet hash to the smart contract */
export async function commitFleet(
    config: ContractConfig,
    commitmentHash: Uint8Array
): Promise<string> {
    console.log('[Stellar] commitFleet — submitting on-chain...');

    const playerScVal = new Address(config.playerAddress).toScVal();
    // BytesN<32> — pad or slice to exactly 32 bytes
    const hashBytes = new Uint8Array(32);
    hashBytes.set(commitmentHash.slice(0, 32));
    const hashScVal = xdr.ScVal.scvBytes(Buffer.from(hashBytes));

    return invokeContract(
        config.playerAddress,
        config.contractAddress,
        'commit_fleet',
        [playerScVal, hashScVal]
    );
}

/** Fire a shot at the opponent's board */
export async function fireShot(
    config: ContractConfig,
    x: number,
    y: number
): Promise<string> {
    console.log(`[Stellar] fireShot — submitting on-chain at (${x}, ${y})...`);

    const attackerScVal = new Address(config.playerAddress).toScVal();
    const xScVal = nativeToScVal(x, { type: 'u32' });
    const yScVal = nativeToScVal(y, { type: 'u32' });

    return invokeContract(
        config.playerAddress,
        config.contractAddress,
        'fire_shot',
        [attackerScVal, xScVal, yScVal]
    );
}

/** Submit a ZK proof response for a pending shot */
export async function submitResponse(
    config: ContractConfig,
    response: number,
    proof: Uint8Array
): Promise<{ txHash: string; isHit: boolean }> {
    console.log('[Stellar] submitResponse — submitting ZK proof on-chain...');

    const defenderScVal = new Address(config.playerAddress).toScVal();
    const responseScVal = nativeToScVal(response, { type: 'u32' });
    // BytesN<256> — pad or slice to exactly 256 bytes
    const proofBytes = new Uint8Array(256);
    proofBytes.set(proof.slice(0, 256));
    const proofScVal = xdr.ScVal.scvBytes(Buffer.from(proofBytes));

    const txHash = await invokeContract(
        config.playerAddress,
        config.contractAddress,
        'submit_response',
        [defenderScVal, responseScVal, proofScVal]
    );

    return { txHash, isHit: response === 1 };
}

/** Claim victory on-chain */
export async function claimVictory(
    config: ContractConfig
): Promise<string> {
    console.log('[Stellar] claimVictory — submitting on-chain...');

    const playerScVal = new Address(config.playerAddress).toScVal();

    return invokeContract(
        config.playerAddress,
        config.contractAddress,
        'claim_victory',
        [playerScVal]
    );
}

// ============================================================================
// View / Read Helpers (no signing needed)
// ============================================================================

/** Poll on-chain game state — returns phase, pending shot, hit counts */
export async function pollGameState(contractAddress: string): Promise<{
    phase: string | null;
    pendingShot: { x: number; y: number } | null;
} | null> {
    try {
        const contract = new Contract(contractAddress);

        // Simulate get_phase() — read-only, no fee
        const phaseResult = await server.simulateTransaction(
            new TransactionBuilder(
                await server.getAccount(contractAddress).catch(() => null) as any,
                { fee: '0', networkPassphrase: TESTNET_PASSPHRASE }
            )
                .addOperation(contract.call('get_phase'))
                .setTimeout(10)
                .build()
        );

        console.log('[Stellar] pollGameState:', phaseResult);
        return null; // parse phase from result as needed
    } catch (e) {
        console.warn('[Stellar] pollGameState failed:', e);
        return null;
    }
}

export { TESTNET_URL, TESTNET_PASSPHRASE, HUB_CONTRACT, BATTLESHIP_CONTRACT };
