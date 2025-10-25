# A simple creative Scrabble variant (GERMAN!)

There is something I love about Scrabble - playing with words, thinking about which word to put next.

There is something I hate about Scrabble - the tactics, not putting a beautiful word there because it would open up a triple word value for my opponent, for example.

So here is a fully functional variant that doesn't use letter values and multipliers on squares. It asks an LLM to judge your word(s) in terms of how rare, creative and beautiful your words are. No, this is not a precise thing, but on average you get awarded score for finding great words, and not for tactics.

![Screenshot](https://github.com/kagsteiner/Wortkunst/blob/5231583cf929dd5af4c1df430156ff7045368213/screenshot.png)

## Setup

You can use three different LLM judges:
- Mistral Large
- Claude Haiku 4.5
- deepseek chat

I have not included OpenAI models because in recent tests I found the performance of gpt-5, gpt-5-mini and even gpt-5-nano too slow for an app where the player has to sit there and wait for the judgement.

Edit .env to include working API keys for the LLMs you want to support. Maybe change function renderHome() in public/app.js by removing LLMs you don't want.

Afterwards do a

npm init -y
npm install
npm run dev

And then you can connect to localhost:3008 to start playing.

NB: The game is in German, uses the German letters incl. Umlauts. It should be no big deal to change it to English. Particularly look into createGermanTileBag in game.js.

## How it works

The game has two screens.

### Matchmaking screen
In this screen you select the number of players (1-4). Then click on "Neues Spiel", and you will see an URL for each player. Invite your friends by copying their URL and sending it to them. (yes, high-tech).

### Game Screen
On the game screen the person who invited can start the game at any time. You see who is present with little green arrows.

Then one player makes the first move according to normal scrabble rules. 
* "Zug bestätigen" will finish your move. Then you have to wait a few seconds for the LLM to judge your move. Then it's the next player's turn.
* "Tauschen" swaps stones.
* "Passen" doesn't do anything, it's the next player's turn. If everyone hit "Passen" the game is over
* "Zurückholen" undoes the stones you have put on the board and restarts your move.

Have fun.

## Cost warning
This game has no login mechanism whatsover. Everyone can create games with everyone. And for every LLM judging your move you will pay a tiny amount to Mistral. Normal players is not a big deal; a full game will cost less than a Euro. But there are malicious people on the internet and a script that calls the LLM API just to make you pay is easy. I run it on my local server that is not connected to the internet.

## More details
The full spec is found in specification.md - the code was fairly straightforward built by Cursor+GPT5 from this spec. (had to fix two minor bugs).

