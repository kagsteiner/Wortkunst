# A simple creative Scrabble variant

There is something I love about Scrabble - playing with words, thinking about which word to put next.

There is something I hate about Scrabble - the tactics, not putting a beautiful word there because it would open up a triple word value for my opponent, for example.

So here is a fully functional variant that doesn't use letter values and multipliers on squares. It asks an LLM to judge your word(s) in terms of how rare, creative and beautiful your words are. No, this is not a precise thing, but on average you get awarded score for finding great words, and not for tactics.

## Setup

This app uses the LLM mistral-large-latest from Mistral. No other one. So head over to mistral.ai and get your API Key. Then copy it into the .env file.

Afterwards do a
```
npm init -y
npm install
npm run dev
´´´

And then you can connect to localhost:3008 to start playing.

## How it works
