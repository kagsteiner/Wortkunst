export const BOARD_SIZE = 15;
export const CENTER = { x: 7, y: 7 };

export function cloneBoard(board) {
    return board.map((row) => row.map((c) => (c ? { ...c } : null)));
}

export function placeTilesVirtual(board, placedTiles) {
    const b = cloneBoard(board);
    for (const t of placedTiles) {
        if (t.x < 0 || t.y < 0 || t.x >= BOARD_SIZE || t.y >= BOARD_SIZE) return { ok: false, error: 'out_of_bounds' };
        if (b[t.y][t.x]) return { ok: false, error: 'cell_occupied' };
        b[t.y][t.x] = {
            letter: String(t.isBlank ? (t.assignedLetter || '') : (t.letter || '')).toUpperCase(),
            isBlank: !!t.isBlank,
            assignedLetter: t.isBlank ? String(t.assignedLetter || '').toUpperCase() : undefined
        };
        if (b[t.y][t.x].isBlank && !b[t.y][t.x].assignedLetter) return { ok: false, error: 'blank_missing_letter' };
    }
    return { ok: true, board: b };
}

export function validatePlacementAndExtractWords(board, placedTiles, isFirstMove) {
    if (!placedTiles || placedTiles.length === 0) return { ok: false, error: 'no_tiles' };
    // All in same row or column
    const xs = new Set(placedTiles.map((t) => t.x));
    const ys = new Set(placedTiles.map((t) => t.y));
    const sameRow = ys.size === 1;
    const sameCol = xs.size === 1;
    if (!sameRow && !sameCol) return { ok: false, error: 'not_single_line' };

    // Virtual place
    const placed = placeTilesVirtual(board, placedTiles);
    if (!placed.ok) return placed;
    const b = placed.board;

    // Contiguity: between min and max along the line no gaps when considering existing tiles
    if (sameRow) {
        const y = placedTiles[0].y;
        const minX = Math.min(...placedTiles.map((t) => t.x));
        const maxX = Math.max(...placedTiles.map((t) => t.x));
        for (let x = minX; x <= maxX; x++) {
            if (!b[y][x]) return { ok: false, error: 'gap_in_line' };
        }
    } else {
        const x = placedTiles[0].x;
        const minY = Math.min(...placedTiles.map((t) => t.y));
        const maxY = Math.max(...placedTiles.map((t) => t.y));
        for (let y = minY; y <= maxY; y++) {
            if (!b[y][x]) return { ok: false, error: 'gap_in_line' };
        }
    }

    // Connection (except first move): at least one placed tile adjacent (N/E/S/W) to existing tile
    const hadAnyExisting = board.some((row) => row.some((c) => !!c));
    if (hadAnyExisting || !isFirstMove) {
        let connected = false;
        for (const t of placedTiles) {
            const n = neighbors(board, t.x, t.y);
            if (n.some((c) => !!c)) {
                connected = true;
                break;
            }
        }
        if (!connected) return { ok: false, error: 'no_connection' };
    }

    // First move must cover center
    if (!hadAnyExisting && isFirstMove) {
        const coversCenter = placedTiles.some((t) => t.x === CENTER.x && t.y === CENTER.y);
        if (!coversCenter) return { ok: false, error: 'must_cover_center' };
    }

    // Extract words (primary + cross)
    const words = extractWords(b, placedTiles);
    if (words.length === 0) return { ok: false, error: 'no_words' };
    return { ok: true, words, finalBoard: b };
}

function neighbors(board, x, y) {
    const res = [];
    if (y > 0) res.push(board[y - 1][x]);
    if (y < BOARD_SIZE - 1) res.push(board[y + 1][x]);
    if (x > 0) res.push(board[y][x - 1]);
    if (x < BOARD_SIZE - 1) res.push(board[y][x + 1]);
    return res;
}

function extractWords(board, placedTiles) {
    const coordsKey = new Set(placedTiles.map((t) => `${t.x},${t.y}`));
    const sameRow = new Set(placedTiles.map((t) => t.y)).size === 1;
    const sameCol = new Set(placedTiles.map((t) => t.x)).size === 1;
    const words = [];

    // Primary word along the line
    if (sameRow) {
        const y = placedTiles[0].y;
        let minX = Math.min(...placedTiles.map((t) => t.x));
        let maxX = Math.max(...placedTiles.map((t) => t.x));
        while (minX > 0 && board[y][minX - 1]) minX--;
        while (maxX < BOARD_SIZE - 1 && board[y][maxX + 1]) maxX++;
        const word = collectWord(board, minX, y, maxX, y);
        if (word) words.push(word);
    } else if (sameCol) {
        const x = placedTiles[0].x;
        let minY = Math.min(...placedTiles.map((t) => t.y));
        let maxY = Math.max(...placedTiles.map((t) => t.y));
        while (minY > 0 && board[minY - 1][x]) minY--;
        while (maxY < BOARD_SIZE - 1 && board[maxY + 1][x]) maxY++;
        const word = collectWord(board, x, minY, x, maxY);
        if (word) words.push(word);
    }

    // Cross words at each placed tile
    for (const t of placedTiles) {
        if (sameRow) {
            // vertical cross
            let minY = t.y;
            let maxY = t.y;
            while (minY > 0 && board[minY - 1][t.x]) minY--;
            while (maxY < BOARD_SIZE - 1 && board[maxY + 1][t.x]) maxY++;
            if (minY !== maxY) {
                const w = collectWord(board, t.x, minY, t.x, maxY);
                if (w) words.push(w);
            }
        } else if (sameCol) {
            // horizontal cross
            let minX = t.x;
            let maxX = t.x;
            while (minX > 0 && board[t.y][minX - 1]) minX--;
            while (maxX < BOARD_SIZE - 1 && board[t.y][maxX + 1]) maxX++;
            if (minX !== maxX) {
                const w = collectWord(board, minX, t.y, maxX, t.y);
                if (w) words.push(w);
            }
        }
    }

    // Deduplicate identical words formed (as strings)
    const uniq = Array.from(new Set(words.map((w) => w.word))).map((s) => ({ word: s }));
    return uniq;
}

function collectWord(board, x1, y1, x2, y2) {
    const letters = [];
    if (y1 === y2) {
        for (let x = x1; x <= x2; x++) letters.push(board[y1][x]?.assignedLetter || board[y1][x]?.letter || '');
    } else if (x1 === x2) {
        for (let y = y1; y <= y2; y++) letters.push(board[y][x1]?.assignedLetter || board[y][x1]?.letter || '');
    }
    const word = letters.join('').toUpperCase();
    if (!word || word.length === 0) return null;
    return { word };
}


