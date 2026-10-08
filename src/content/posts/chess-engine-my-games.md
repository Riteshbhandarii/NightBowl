---
title: "Training a chess engine on my own games"
date: 2026-10-08
status: published
excerpt: "An engine that does not try to play well. It tries to play like me."
order: 2
---

Every chess engine tries to find the best move. I wanted one that finds my move. TEORIAT is a chess engine trained only on my own Chess.com games, and its whole job is to copy how I actually play.

## From games to data

The first step was getting the data. I pull complete game histories from Chess.com, parse them and store them in PostgreSQL. One table holds the games with results and time controls. Another table holds every single move with its game, its move number, the colour and whether I played it.

## Turning moves into something a model can read

Each move becomes a small tuple of three numbers. The colour of the player, an index for the move in a shared vocabulary, and a flag that says whether the move was mine. The move index goes through an embedding layer of size 32, and the other two numbers are added on, so every move ends up as 34 numbers.

## The model

The model is a stacked LSTM written in PyTorch. One layer with 128 units, then one with 64, then a classification head that outputs a probability for every move in the vocabulary. It trains with cross entropy and the Adam optimizer. I split the data by time, so the model is always tested on games that came after the ones it learned from.

The important part is what it is not asked to do. It does not evaluate the position and it does not search for the best line. It only looks at the moves so far and guesses what I would play next. So when it makes a bad move, that is sometimes the point. It is making my mistakes.

## Playing against it

The model runs behind a FastAPI backend, and the frontend is a React app on Vercel. You can pick a time control, play against TEORIAT with a clock and a move list, and your result goes on a leaderboard.

You can [play it here](https://chess-engine-two.vercel.app) and the code is on [GitHub](https://github.com/Riteshbhandarii/Chess-engine).
