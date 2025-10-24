import { nanoId10, nanoId22, shuffleArrayInPlace } from './utils.js';
import { BOARD_SIZE, validatePlacementAndExtractWords } from './validate.js';
import { evaluateWords } from './llm.js';

const games = new Map(); // gameId -> game

export function createGame(playerCount, baseUrl, llmProvider = 'mistral') {
    const gameId = nanoId10();
    const playerSeats = Array.from({ length: playerCount }).map((_, idx) => ({
        seatId: `S${idx + 1}`,
        seatToken: nanoId22(),
        displayName: undefined,
        connected: false,
        joinedAt: undefined
    }));
    const hostSeatId = playerSeats[0].seatId;
    const game = {
        gameId,
        status: 'lobby',
        playerSeats,
        hostSeatId,
        seatsLocked: false,
        turnIndex: 0,
        bag: createGermanTileBag(),
        board: createEmptyBoard(),
        racks: {},
        scores: {},
        moveHistory: [],
        config: { noPremiumSquares: true, endPenaltyPerTile: 100, initialSeatCount: playerCount },
        consecutivePasses: 0,
        startedAt: undefined,
        endedAt: undefined,
        baseUrl,
        llmProvider
    };
    // Initialize racks and scores
    for (const seat of game.playerSeats) {
        game.racks[seat.seatId] = [];
        game.scores[seat.seatId] = 0;
    }
    shuffleArrayInPlace(game.bag);
    games.set(gameId, game);
    return game;
}

export function getGame(gameId) {
    return games.get(gameId);
}

export function getSeatFromToken(game, seatToken) {
    return game.playerSeats.find((s) => s.seatToken === seatToken);
}

export function joinSeatByToken(gameId, seatToken, displayName) {
    const game = getGame(gameId);
    if (!game) return null;
    const seat = getSeatFromToken(game, seatToken);
    if (!seat) return null;
    if (game.status === 'active' && !seat.joinedAt) return null; // mid-game new join not allowed
    seat.connected = true;
    seat.joinedAt = seat.joinedAt || Date.now();
    if (displayName && typeof displayName === 'string' && displayName.length <= 30) seat.displayName = displayName;
    return seat;
}

export function startGame(gameId, seatToken) {
    const game = getGame(gameId);
    if (!game) return false;
    const seat = getSeatFromToken(game, seatToken);
    if (!seat) return false;
    if (seat.seatId !== game.hostSeatId) return false;
    if (game.status !== 'lobby') return false;

    // Lock seats to only those who joined before start
    game.playerSeats = game.playerSeats.filter((s) => !!s.joinedAt);
    if (game.playerSeats.length === 0) return false;
    game.seatsLocked = true;
    // Ensure racks and scores only for joined seats
    const newRacks = {};
    const newScores = {};
    for (const s of game.playerSeats) {
        newRacks[s.seatId] = [];
        newScores[s.seatId] = 0;
    }
    game.racks = newRacks;
    game.scores = newScores;

    // Draw initial racks up to 7
    for (const s of game.playerSeats) {
        drawToSeven(game, s.seatId);
    }
    game.status = 'active';
    game.startedAt = Date.now();
    game.turnIndex = 0;
    game.consecutivePasses = 0;
    return true;
}

export function markDisconnected(gameId, seatId) {
    const game = getGame(gameId);
    if (!game) return;
    const seat = game.playerSeats.find((s) => s.seatId === seatId);
    if (seat) seat.connected = false;
}

export function serializeStateForSeat(game, seatId) {
    const you = seatId;
    const youRack = game.racks[you] || [];
    const others = Object.fromEntries(
        game.playerSeats
            .filter((s) => s.seatId !== you)
            .map((s) => [s.seatId, { rackCount: (game.racks[s.seatId] || []).length, connected: s.connected, displayName: s.displayName || null }])
    );
    const turnSeatId = game.playerSeats[game.turnIndex]?.seatId;
    return {
        gameId: game.gameId,
        status: game.status,
        hostSeatId: game.hostSeatId,
        seatsLocked: game.seatsLocked,
        youSeatId: you,
        seats: game.playerSeats.map((s) => ({ seatId: s.seatId, connected: s.connected, displayName: s.displayName || null })),
        board: game.board,
        rack: youRack,
        others,
        scores: game.scores,
        bagCount: game.bag.length,
        turnSeatId,
        lastMove: game.moveHistory[game.moveHistory.length - 1] || null,
        config: game.config,
        llmProvider: game.llmProvider
    };
}

export function getPublicGameSummary(game) {
    return {
        gameId: game.gameId,
        status: game.status,
        seats: game.playerSeats.map((s) => ({ seatId: s.seatId, connected: s.connected, displayName: s.displayName || null })),
        hostSeatId: game.hostSeatId
    };
}

export async function handleMovePlace(game, seatToken, tiles) {
    if (game.status !== 'active') return { ok: false, error: 'not_active' };
    const seat = getSeatFromToken(game, seatToken);
    if (!seat) return { ok: false, error: 'not_joined' };
    const turnSeatId = game.playerSeats[game.turnIndex]?.seatId;
    if (seat.seatId !== turnSeatId) return { ok: false, error: 'not_your_turn' };

    // Verify tiles are from rack
    const rack = game.racks[seat.seatId];
    const rackCopy = [...rack];
    for (const t of tiles) {
        const idx = rackCopy.findIndex((r) => tileMatches(r, t));
        if (idx === -1) return { ok: false, error: 'tiles_not_in_rack' };
        rackCopy.splice(idx, 1);
    }

    const isFirstMove = isBoardEmpty(game.board);
    const validation = validatePlacementAndExtractWords(game.board, tiles, isFirstMove);
    if (!validation.ok) return { ok: false, error: validation.error };

    // Apply to board
    game.board = validation.finalBoard;

    // Remove tiles from rack
    for (const t of tiles) {
        const idx = game.racks[seat.seatId].findIndex((r) => tileMatches(r, t));
        if (idx !== -1) game.racks[seat.seatId].splice(idx, 1);
    }

    // Compute words list for LLM
    const words = validation.words.map((w) => w.word);
    console.log(`[GAME] Player ${seat.seatId} placing tiles, calling LLM (${game.llmProvider}) to evaluate words: ${words.join(', ')}`);
    let evalResult;
    try {
        evalResult = await evaluateWords(words, game.llmProvider);
        console.log(`[GAME] LLM evaluation completed successfully for player ${seat.seatId}. Evaluated ${evalResult.evaluations?.length || 0} words`);
    } catch (e) {
        console.log(`[GAME] LLM evaluation failed for player ${seat.seatId}: ${e.message}`);
        // On failure, record a failed result and allow user to retry via client action (not implemented server-side). For now, return error.
        return { ok: false, error: 'llm_failed' };
    }
    const moveScore = (evalResult.evaluations || []).reduce((sum, e) => sum + (Number(e.score) || 0), 0);
    console.log(`[GAME] Player ${seat.seatId} move completed with score: ${moveScore} (total score: ${(game.scores[seat.seatId] || 0) + moveScore})`);

    // Update score
    game.scores[seat.seatId] = (game.scores[seat.seatId] || 0) + moveScore;

    // Move history
    const explanationsConcat = (evalResult.evaluations || [])
        .map((e) => `${e.word}: ${e.explanation}`)
        .join(' ');
    game.moveHistory.push({
        seatId: seat.seatId,
        placedTiles: tiles,
        words,
        perWordEvaluations: evalResult.evaluations,
        moveScore,
        explanationText: explanationsConcat,
        timestamp: Date.now()
    });

    // Draw new tiles
    drawToSeven(game, seat.seatId);

    // Advance turn
    game.consecutivePasses = 0;
    advanceTurn(game);

    // Endgame check
    checkEndgame(game);

    return { ok: true };
}

export function handleExchange(game, seatToken, rackIndices) {
    if (game.status !== 'active') return { ok: false, error: 'not_active' };
    const seat = getSeatFromToken(game, seatToken);
    if (!seat) return { ok: false, error: 'not_joined' };
    const turnSeatId = game.playerSeats[game.turnIndex]?.seatId;
    if (seat.seatId !== turnSeatId) return { ok: false, error: 'not_your_turn' };
    if (!Array.isArray(rackIndices) || rackIndices.length === 0) return { ok: false, error: 'no_tiles_selected' };
    if (game.bag.length < 7) return { ok: false, error: 'bag_too_small' };
    const rack = game.racks[seat.seatId];
    const indices = Array.from(new Set(rackIndices)).filter((i) => Number.isInteger(i) && i >= 0 && i < rack.length).sort((a, b) => b - a);
    const toSwap = indices.map((i) => rack[i]);
    for (const i of indices) rack.splice(i, 1);
    // Return to bag and draw same count
    game.bag.push(...toSwap);
    shuffleArrayInPlace(game.bag);
    while (rack.length < 7 && game.bag.length > 0) rack.push(game.bag.pop());
    // Exchange scores 0
    game.moveHistory.push({ seatId: seat.seatId, placedTiles: [], words: [], perWordEvaluations: [], moveScore: 0, explanationText: '', timestamp: Date.now(), action: 'exchange' });
    game.consecutivePasses = 0;
    advanceTurn(game);
    checkEndgame(game);
    return { ok: true };
}

export function handlePass(game, seatToken) {
    if (game.status !== 'active') return { ok: false, error: 'not_active' };
    const seat = getSeatFromToken(game, seatToken);
    if (!seat) return { ok: false, error: 'not_joined' };
    const turnSeatId = game.playerSeats[game.turnIndex]?.seatId;
    if (seat.seatId !== turnSeatId) return { ok: false, error: 'not_your_turn' };
    game.moveHistory.push({ seatId: seat.seatId, placedTiles: [], words: [], perWordEvaluations: [], moveScore: 0, explanationText: '', timestamp: Date.now(), action: 'pass' });
    game.consecutivePasses += 1;
    advanceTurn(game);
    checkEndgame(game);
    return { ok: true };
}

function checkEndgame(game) {
    // Condition 1: a player emptied rack and bag is empty
    const anyRackEmpty = game.playerSeats.some((s) => (game.racks[s.seatId] || []).length === 0);
    if (anyRackEmpty && game.bag.length === 0) return endGame(game);
    // Condition 2: all players passed once in a row
    if (game.consecutivePasses >= game.playerSeats.length) return endGame(game);
}

function endGame(game) {
    // Apply penalties
    for (const s of game.playerSeats) {
        const remaining = (game.racks[s.seatId] || []).length;
        game.scores[s.seatId] = (game.scores[s.seatId] || 0) - game.config.endPenaltyPerTile * remaining;
    }
    game.status = 'ended';
    game.endedAt = Date.now();
}

function advanceTurn(game) {
    game.turnIndex = (game.turnIndex + 1) % game.playerSeats.length;
}

function isBoardEmpty(board) {
    return !board.some((row) => row.some((c) => !!c));
}

function drawToSeven(game, seatId) {
    const rack = game.racks[seatId];
    while (rack.length < 7 && game.bag.length > 0) {
        rack.push(game.bag.pop());
    }
}

function tileMatches(a, b) {
    if (!a || !b) return false;
    if (!!a.isBlank !== !!b.isBlank) return false;
    if (a.isBlank) {
        // For blanks, only identity by being blank; assignment happens at placement
        return true;
    }
    return String(a.letter).toUpperCase() === String(b.letter).toUpperCase();
}

function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
}

function createGermanTileBag() {
    // Distribution from spec (counts only)
    const dist = {
        'A': 5, 'B': 2, 'C': 2, 'D': 4, 'E': 15, 'F': 2, 'G': 3, 'H': 4, 'I': 6, 'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 9, 'O': 3, 'P': 1, 'Q': 1, 'R': 6, 'S': 7, 'T': 6, 'U': 6, 'V': 1, 'W': 1, 'X': 1, 'Y': 1, 'Z': 1, 'Ä': 1, 'Ö': 1, 'Ü': 1
    };
    const bag = [];
    for (const [letter, count] of Object.entries(dist)) {
        for (let i = 0; i < count; i++) bag.push({ letter, isBlank: false });
    }
    // 2 blanks
    bag.push({ isBlank: true });
    bag.push({ isBlank: true });
    shuffleArrayInPlace(bag);
    return bag;
}


