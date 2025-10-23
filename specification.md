# Wortkunst — Specification (MVP)

A private, friends-only, German-language word game inspired by Scrabble, focused on creativity rather than classical letter values. The app keeps the German tile set and placement rules, removes premium squares, and replaces scoring with an LLM-based aesthetic evaluation per word.

## Goals
- Celebrate the beauty, creativity, and rarity of German words.
- Keep placement mechanics very close to German Scrabble while removing premium-square strategy.
- Make it simple for a host to start a private game with friends via shareable URLs.
- Keep technology small, simple, and real-time, with minimal dependencies.
- Support solo play.

## Non-Goals (MVP)
- No public lobby, matchmaking, or ranking.
- No authentication or accounts.
- No in-depth fairness or anti-cheat systems.
- No telemetry or analytics.
- No content moderation.
- No crash recovery beyond reconnecting to a still-running game process.
- No dictionary enforcement and no challenge system.
- No mid-game joining by players who did not join before the game started.
- No explicit RFC compliance documentation or TLS termination details.

## Game Rules

### Board
- Size: 15x15 grid.
- No premium squares (no letter or word multipliers).
- Center square is the starting anchor (no multiplier); the first move must cover it.
- Tiles remain on the board once placed; no rearranging past moves.

### Tile Set (German)
- Use the official German Scrabble letter distribution as basis (counts only; no letter values are used).
- Tile counts (total 102 including 2 blanks):
  - A×5, B×2, C×2, D×4, E×15, F×2, G×3, H×4, I×6, J×1, K×2, L×3, M×4, N×9, O×3, P×1, Q×1, R×6, S×7, T×6, U×6, V×1, W×1, X×1, Y×1, Z×1, Ä×1, Ö×1, Ü×1, Blank×2
- Umlauts (Ä, Ö, Ü) are distinct tiles and are in the bag as above.
- ß is not a tile; players can use SS to represent it if needed.
- Blank tiles have no letter printed and can represent any single letter (including umlauts) when placed; once set, they remain that letter for the rest of the game.

### Racks
- Each player holds up to 7 tiles.
- Draw from the shuffled tile bag to refill after each turn.

### Turn Sequence
- On a player’s turn, they may:
  - Place tiles: Place one or more tiles in a single contiguous line (row or column), connecting to existing tiles except on the first move. Standard Scrabble adjacency/continuity rules apply:
    - Tiles placed must be in one row or one column, with no gaps between placed tiles.
    - All formed words must be contiguous and intersect existing tiles (except first move).
    - All newly formed perpendicular cross-words must also be validly formed by adjacency.
  - Exchange tiles: Swap any number of tiles from the rack with random tiles from the bag (only allowed if the bag has at least 7 tiles). Score for that turn is 0.
  - Pass: Do nothing. Score for that turn is 0.
- No timers.

### Dictionary and Challenges
- MVP uses no dictionary. Friends self-police word validity via social agreement.
- No in-app challenge mechanism. The LLM does not adjudicate validity; it only evaluates aesthetic categories.

### Words for Scoring per Move
- All words formed by the placement are collected:
  - The main (primary) word along the placed line.
  - All cross-words created by new adjacencies.
- Each distinct formed word is sent to the LLM for scoring and explanation independently.

### Endgame
- Ends under standard Scrabble conditions:
  - When a player uses all tiles and the bag is empty; or
  - A sequence of passes occurs that indicates play is stalled (e.g., all players pass consecutively; exact threshold may be configurable; default: all players pass once in a row).
- Unused tile penalty at game end: Subtract 100 points per remaining tile on a player’s rack from that player’s total score. This is a fixed constant for MVP and applies to blanks as well.

## Scoring (LLM-Based)
- Model: Mistral Large.
- Categories: creativity, rarity, beauty of the word.
- Per-word scoring:
  - Each word receives a score from 1 to 100 and a short explanation.
  - The move score = sum of all per-word scores from that move.
  - All explanations from that move are concatenated and displayed to the player.
- No additional bonuses for word length, placement, or board position.
- Let the LLM judge across the categories as it sees fit; no manual weighting in the app.
- Do not instruct the LLM with anchoring language (e.g., do not say “50 is average”).
- If the player exchanges tiles or passes, the move score is 0.

## Matchmaking, Sessions, and Access

### Player Count
- 1–4 players per game. Solo mode supported (play alone for personal high scores).

### Host Flow
- Host selects the number of player seats (1–4).
- Server creates a game with N pre-allocated seats and generates one unique URL per player seat.
- The host must join (using the host seat URL) to start the game.
- The host can start the game at any time after joining, regardless of how many other seats have joined:
  - When the host starts, any seats that have not yet joined are permanently blocked for this game (cannot be joined mid-game).
  - The effective player count for the game becomes the number of seats joined at the moment of start.

### Joining
- Players join by clicking their unique URL.
- No authentication or accounts. The per-player URL identifies both game and seat.
- No lobby or public visibility. Private-only, by link.
- Joining after the game starts:
  - New players who did not join before start cannot join mid-game.
  - Players who already joined before start can disconnect and reconnect via the same URL to reclaim their seat.

### Reconnects and Offline
- If a player disconnects, they can rejoin using the same URL (reclaim their seat).
- If a player is offline during their turn, the game is effectively paused; others see a message that the game is waiting for that player.
- No kicking, no revocation, no expiration of URLs (MVP).
- Persistence is in-memory; if the server process crashes, game state may be lost (MVP).

## LLM Integration

### Model and Parameters
- Model: Mistral Large.
- Temperature: 0.0.
- Top-p, frequency/presence penalties: provider defaults unless required.
- Language: Prompt in English; explicitly note that the game language is German and all words are German.
- Prompting constraints:
  - Specify categories (creativity, rarity, beauty) and the 1–100 scale.
  - Do not include anchoring such as defining “average” as 50 or similar.

### Privacy
- Send only the list of distinct words formed in the move and minimal context needed for evaluation (e.g., “language is German” and category definitions).
- Do not send player names, game IDs, board positions, or any PII.

### Request Contract (MVP)
- Input: JSON with fields:
  - language: "German"
  - words: array of strings (unique words formed this move)
  - instructions: brief description of categories (creativity, rarity, beauty), scale (1–100), and output schema
- Output (required): JSON with:
  - evaluations: array of objects, each:
    - word: string
    - score: integer 1–100
    - explanation: short string (1–2 sentences), in German if possible

Example prompt (English; keep short and clear):
- System instruction: “You are evaluating German words for a friendly, creativity-focused word game.”
- User content:
  - “Language: German. For each word, return a score 1–100 based on creativity, rarity, and beauty of the word. No additional bonuses for length or position. Output JSON with evaluations: [{word, score, explanation}]. Words: [‘WORT1’, ‘WORT2’, ...]. Keep explanations brief.”

### Concurrency and Latency
- Server limits concurrent LLM requests with a simple configurable JS constant (e.g., CONCURRENT_LLM_REQUESTS). Default value can be small (e.g., 2); adjust as needed.
- Additional requests are queued FIFO on the server.
- No complex latency optimizations or streaming required in MVP. The UI may simply show a “Scoring…” state until the result arrives.

### Failure Handling
- Assume players are online and the LLM is available.
- If a request fails, automatically retry the same request (simple retry, e.g., up to 3 attempts with brief delay).
- No offline fallback or alternate scoring path.
- If all retries fail, present a simple “Rating failed. Retry” option in the UI.
- No strict custom timeouts are required beyond provider defaults; users can retry manually.

## System Architecture

### Technology Choices
- Client: HTML5 + CSS + vanilla JavaScript. Avoid large frameworks.
- Server: Node.js with minimal libraries.
- Real-time: WebSockets for live updates; minimal “ws”-style implementation.
- HTTP: Minimal REST endpoints for game creation and static asset serving.
- Protocol specifics (RFC references) are not required in the MVP documentation.

### Real-Time Behavior
- All players see board updates, turn changes, rack sizes (counts only), scores, and LLM explanations in real time.
- Only the active player can place tiles on their turn; others are view-only.
- Prevent concurrent move submissions by enforcing server-side turn ownership.
- Upon move submission, the server validates placement, constructs the word list, calls the LLM, and broadcasts the scoring result.

### Persistence
- In-memory game state per process.
- Reconnects supported while the process is alive.
- No database (MVP).

### RNG
- Use a simple RNG (e.g., Math.random) for shuffling the tile bag and draw order.
- No fairness/crypto guarantees (MVP).

## API and URLs

### URL Format (example)
- Create game (host): POST /api/games with {playerCount}
- Server response: JSON with:
  - gameId: short base62 ID (e.g., 10–12 chars)
  - playerUrls: array of absolute URLs, one per seat:
    - https://example.com/g/{gameId}/p/{seatToken}
- Join: GET https://example.com/g/{gameId}/p/{seatToken}
  - seatToken is a random base62 string (e.g., 16–24 chars) that identifies both game and seat.
- Start: POST /api/games/{gameId}/start (host only; authenticated by possession of host seat URL)

Notes:
- No expiration (TTL), revocation, or kicking in MVP.
- Rejoin by revisiting the same per-seat URL.
- Seats not joined at the moment of start become blocked for the remainder of the game.

## Data Model (In-Memory)

- Game
  - gameId
  - status: lobby | active | ended
  - playerSeats: [seatId, seatToken, displayName? (optional, client-set), connected, joinedAt?]
  - hostSeatId
  - seatsLocked: boolean (true after start; prevents new joins to unjoined seats)
  - turnIndex
  - bag: multiset of tiles
  - board: 15x15 grid (cells: {letter, isBlank, blankAssignedLetter})
  - racks: map seatId -> [tiles]
  - scores: map seatId -> integer
  - moveHistory: list of {seatId, placedTiles: [{x,y,letter,isBlank,assignedLetter}], words: [string], perWordEvaluations, moveScore, timestamp}
  - config:
    - noPremiumSquares: true
    - endPenaltyPerTile: 100
    - initialSeatCount: 1–4

- Tile
  - letter: one of [A–Z with German umlauts Ä, Ö, Ü], or Blank
  - isBlank: boolean

## UI/UX Outline (MVP)
- Home/New Game:
  - Select player count (1–4).
  - Create game -> show per-player URLs and a “Copy All” button.
  - Lobby view: shows which seats have joined; host must join to enable Start.
  - Host can start even if not all seats have joined; unjoined seats are then blocked.
- Game View:
  - 15x15 board grid (no premium markings).
  - Rack with draggable tiles.
  - Controls: Place, Confirm Move, Exchange, Pass, Recall Tiles.
  - Exchange dialog: select tiles to swap; confirm.
  - Scores panel: running totals per player.
  - Turn indicator: shows whose turn it is.
  - Move result: shows total move score and concatenated explanations per word.
  - Connection status: shows waiting state when current player offline.
  - Solo mode: same UI with single seat.
- Accessibility:
  - Provide keyboard placement as a fallback (optional in MVP if time allows).
  - Clear visual distinction for newly placed tiles before confirmation.

## Placement Validation (Server-Side)
- Enforce single line placement (row or column).
- Enforce contiguity (no gaps).
- Enforce correct connection to existing tiles (except the first move).
- Enforce that the first move covers the center square.
- Compute all formed words (primary and cross-words) by scanning continuous sequences including newly placed tiles.
- Do not validate words against a dictionary.

## End-of-Game Computation
- When end conditions met:
  - Apply -100 points per remaining tile on each player’s rack.
  - Determine winner(s) by highest total score.
  - Present final scoreboard.

## Privacy and Legal
- Privacy:
  - No telemetry or analytics.
  - LLM receives only the list of words formed in a move and minimal instructions; no PII.
- Legal/Naming:
  - Avoid using “Scrabble” in name or marketing.
  - Product name: “Wortkunst”.
  - Tagline suggestion: “Das kreative Wortspiel unter Freunden.”

## Internationalization
- Game language is German; UI can be German or bilingual as desired.
- LLM explanations may be requested in German; if the model replies in English, the app may display as-is (no translation required for MVP).

## Nice-to-Have (Deferred)
- Optional house rules (e.g., adjustable end penalty).
- In-app chat.
- Dictionary validation and optional challenge flow.
- Persistence to a database for crash recovery.
- Spectator links.
- Mobile-optimized drag-and-drop enhancements.
- Rich animations and sound.
- Long-turn mitigation (e.g., optional timers).
- Alternate tile distributions or custom sets.

## Test Scenarios (MVP)
- Create 1–4 player games; join via URLs; start.
- Host must join before starting; starting with unjoined seats blocks those seats for the rest of the game.
- First move covering center.
- Multi-word placements generating multiple LLM evaluations; sum scores and show concatenated explanations.
- Exchange tiles (bag >= 7) with 0 points.
- Pass with 0 points.
- Solo game flow.
- Disconnection and reconnection via same URL (only for seats that joined before start).
- Endgame with penalties applied correctly.
- LLM retry behavior on transient failures.
- Concurrency limit for LLM calls respected; queued requests processed FIFO.

## Operational Notes
- Configure Mistral API endpoint and key via environment variables.
- LLM concurrency: set via a simple JS constant (e.g., CONCURRENT_LLM_REQUESTS) on the server.
- Rate limiting: simple client-side throttle of move submissions; server may queue LLM calls.
- Logging: minimal server logs for game lifecycle and LLM request/response status (no PII).
- Deployment: single Node.js process acceptable for MVP; sticky sessions not required.
- TLS termination and detailed protocol/RFC documentation are out of scope for MVP (use platform defaults or hosting provider solutions).
