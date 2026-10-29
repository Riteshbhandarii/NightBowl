---
name: "TEORIAT Chess Engine"
course: "mains"
tag: "PyTorch"
summary: "A chess AI trained only on my own Chess.com history. It encodes each move as a compact tuple and predicts my next move, imitating how I actually play rather than how an engine would."
status: "published"
contribution: "Solo project. Data collection, database, model, backend and the playable web app."
context: "Personal project. The goal was an engine that plays like one specific person, mistakes included, instead of finding the best move."
stack:
  - "Python"
  - "PyTorch"
  - "PostgreSQL"
  - "FastAPI"
  - "React"
  - "Vercel"
sourceUrl: "https://github.com/Riteshbhandarii/Chess-engine"
demoUrl: "https://chess-engine-two.vercel.app"
order: 3
draftCopy: false
---

## The problem

Every chess engine tries to find the best move. I wanted one that finds my move. TEORIAT is trained only on my own Chess.com games, and its whole job is to copy how I actually play.

## What I built

- **Data.** Complete game histories are pulled from Chess.com, parsed and stored in PostgreSQL. One table holds games with results and time controls, another holds every move with its game, move number, colour and whether I played it.
- **Encoding.** Each move becomes a tuple of three numbers: the colour, an index into a shared move vocabulary, and a flag for whether the move was mine. The move index goes through a 32-dimensional embedding and the other two numbers are added on, so every move is 34 numbers.
- **Model.** A stacked LSTM in PyTorch, 128 units then 64, with a classification head over the move vocabulary. It trains with cross entropy and Adam.
- **Evaluation.** The data is split by time, so the model is always tested on games played after the ones it learned from.
- **App.** The model runs behind a FastAPI backend. The React frontend on Vercel has time controls, a clock, a move list and a leaderboard.

## What it does not do

It does not evaluate the position and it does not search. It only looks at the moves so far and guesses what I would play next. When it makes a bad move, that is sometimes the point.

The longer story is in the Kitchen Log: [Training a chess engine on my own games](/log/chess-engine-my-games/).
