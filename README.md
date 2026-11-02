# Paper Football — `index.html`

A self-contained rewrite of [`football.pyw`](football.pyw) in HTML + JavaScript: the same pen-on-graph-paper
game, the same pitch, complete rules, and a CPU that actually plays the game instead of wandering toward a
goal. Rules of the original were reverse-engineered first and are written up in [RULES.md](RULES.md); this
file implements them with the ambiguities resolved (see [Deliberate changes](#deliberate-changes)).

Everything the game needs is inside [`index.html`](index.html): no CDN, no build step, no image or sound
file required. The ball is drawn as an ink sketch on the canvas and the kick is synthesised with WebAudio.
If you serve the folder over http, the original `kick (1..3).wav` files are picked up automatically.

## Open it

Double-click [`index.html`](index.html), or drag it into a browser. To also get the original kick samples:

```
python -m http.server 8000     # then open http://127.0.0.1:8000/index.html
```

Three URL hashes change how the page opens, without touching your saved settings: `index.html#demo` starts a
CPU vs CPU game you can watch, `index.html#level=hard` (or `easy`, `normal`, `expert`) picks the strength for
that opening, and `index.html#dark` opens it on dark paper. Combine them: `index.html#demo#level=expert`.

The whole window is one sheet of graph paper — the page background grid is re-scaled to the pitch grid,
and the pitch is drawn centred on the sheet, as it would be on a real exercise page. Player 1 plays in black,
Player 2 in blue, which is what the game is actually played with: one black and one blue ballpoint.

![The opening pitch on the sheet](preview.png)

A game in progress, opened with `#demo` (the status line reports the CPU's depth, positions searched and
thinking time after every move):

![CPU against CPU](preview-demo.png)

The same sheet drawn in white and pale-blue pencil, opened with `#dark` or chosen under Settings → Paper:

![The same pitch on dark paper](preview-dark.png)

## Keys

| | up-left / up / up-right | left / right | down-left / down / down-right |
|---|---|---|---|
| **Player 1** (black ink, attacks the **top** goal) | `I` `O` `P` | `K` `L` (or `;`) | `,` `.` `/` |
| **Player 1**, number pad | `Num 7` `Num 8` `Num 9` | `Num 4` `Num 6` | `Num 1` `Num 2` `Num 3` |
| **Player 1**, straight only | `↑` | `←` `→` | `↓` |
| **Player 2** (blue ink, attacks the **bottom** goal) | `Q` `W` `E` | `A` `D` | `Z` `X` `C` |

The two clusters are the mirror of each other — left hand for Player 2, right hand (or the number pad) for
Player 1, so a laptop without a number pad still gets a full 8-direction pad. Binding is by physical key,
so any keyboard layout works; the arrow keys are only an extra Player 1 binding.

Other keys: `H` hint (or `T`) · `F3` switch Player 2 ↔ CPU · `R` new game · `U` undo · `M` sound ·
`F1` rules and keys · `Esc` close. The rules panel is on `F1` rather than the usual `?` because `/` and `?`
are Player 1 keys here. Every key action also exists as a button, an on-screen 3×3 key pad, or a click/tap on
the hollow dot you want to kick to.

## Settings

* **Opponent** — solo as Player 1 or Player 2, two players on one keyboard, or CPU vs CPU to watch.
* **CPU strength** — `easy`, `normal`, `hard`, `expert` (see [The CPU](#the-cpu)).
* **Pitch** — small 6 × 10, classic 8 × 12 (exactly the original board), big 10 × 16.
* **Match** — next goal wins, first to 3 or 5, or play until the paper is full.
* **Own goals** — allowed (they win for the other side, as in a real paper game) or forbidden kicks.
* **Show legal dots** — the faint rings next to the ball; turn them off for a real pen-and-paper feel.
* **Paper** — light graph paper (the default, and the look of the original), dark paper, or follow the
  system's light/dark setting. The canvas, the panels and the page grid all switch together, and the switch
  is instant: the sheet is re-drawn, not re-loaded.

Settings and the pitch you chose are remembered in `localStorage`; the printed pitch and the rules are
identical to the original at kick-off, verified by the tests below.

## The CPU

The engine is a full game-tree search, not a distance heuristic:

* negamax with alpha-beta, iterative deepening, zobrist-keyed transposition table (verified with a second
  hash), move ordering (TT move → goal → avoid own goal → bounce → toward the target goal), and a hard
  per-move time budget. A Web Worker does the thinking so the page never freezes; if workers are blocked,
  the same code runs synchronously with a smaller budget.
* **The bounce chain is in the tree.** Landing on a lined dot means the *same* player kicks again, so the
  tree does not alternate; the search keeps the same maximising node instead of negating, which is exactly
  the tactical idea the original CPU could not see. The test suite has a position where `hard` walks a
  bounce ladder into the net in one turn.
* The leaf evaluation is one BFS over still-blank strokes: how many kicks each side is from each goal,
  plus how many strokes are still available next to the ball. Mate distances are stored and re-based
  through the transposition table, so a forced win is preferred earlier and a loss later.
* Levels: `easy` = random among moves that do not lose on the spot, and it takes a free goal;
  `normal` = 6 plies / 0.5 s (about what the original CPU was reaching for, but with you in the loop);
  `hard` = 12 plies / 1.5 s; `expert` = 26 plies / 3.5 s. The status line reports depth, node count and
  thinking time of every CPU move, so the difference between levels is visible on screen.
* `normal`, `hard` and `expert` play the same answer from the same position. When several strokes score
  exactly the same the CPU keeps the order the search sorted them in — goal, avoiding own goals, keeping
  the bounce tempo — instead of drawing one out of a hat; only `easy` varies its play. This also makes the
  test suite reproducible on a busy machine (an earlier version picked randomly among equal moves and a
  tactical test then failed depending on load).

Measured on an idle machine, sudden-death matches on the classic pitch, colours alternated, `node tools/selftest.mjs`
(the suite now also prints the search depth each side actually reached, since a level means a depth *and* the
time to reach it):

| pairing | result | strokes/game | depth reached |
|---|---|---|---|
| easy vs expert | expert 4 – 0 | 17–30 | no search vs ~11 plies |
| normal vs expert | **even — 1 – 3 and 2 – 2 in two runs, i.e. the 6-ply level held its own** | ~105 | 5.7 vs ~15 plies |
| easy vs normal | normal 4 – 0 | 13–17 | no search vs ~5 plies |

**Read that second row carefully: searching six plies matched searching fifteen.** The search is not the
bottleneck. Given 12–26 plies, negamax happily commits to lines whose *leaf* score looks better under a
distance-and-open-space evaluation but which are not better positions — a deep search optimising a shallow
evaluation. The evaluator is the thing to improve first (`RULES.md` §10 is written as a prompt-ready spec for
exactly that). Note also that an earlier build of the engine picked *randomly* among equal-scoring moves; in
that version `expert` won this pairing 4 – 0, which was partly `normal` randomly picking an equal-but-worse
move. Removing that noise is what exposed the depth ranking for what it is — a less flattering and much more
useful number to design against. Because a time-limited search reaches slightly different depths each run,
this pairing moves by a game either way; that is why the suite reports it instead of asserting it.

Against the strong levels, remember how this game is really won: not by shooting, but by leaving the
opponent with no stroke left to draw. The CPU plays that endgame deliberately — expect long matches and
few goals between two strong AIs, and expect to lose the paper if you only attack.

## Deliberate changes

Compared with `football.pyw`, these are choices, not accidents (the numbering follows §8 of [RULES.md](RULES.md)):

1. **The goal-area hatch is visible.** The original drew it and then painted the goal area back to white,
   so players could not see why a kick was illegal or why a bounce happened. It is printed faintly now.
2. **No silent pass.** A CPU with a legal stroke always plays one; being stuck loses for the stuck side,
   for the CPU exactly as for a human. The original returned "no move" and simply gave the turn back.
3. **Own goals are a rule**, shown on screen, with an on/off switch (the original allowed them by accident).
4. **A goal is a match event**: score up, the conceding side kicks off from the centre, the strokes already
   on the paper stay there. Match length is a setting; a full pitch ends the match, and there is no draw
   rule — the side that cannot kick loses.
5. **The pitch size is a setting** instead of depending on your screen size, so "the classic 8 × 12" is a
   reproducible board (404 segments, 80 printed, 324 playable — asserted by the tests).
6. **Player 1 moved to the number pad / `IOPKL,./` cluster**, Player 2 to `QWE/ASD/ZXC`; the original used
   `QWE/ASD/ZXC` for Player 1.
7. **No external assets needed**: the ball sprite and the kick sound are generated. `ball.png` and the
   `.wav` files are only used when they can be fetched (http serving).
8. The AI delay bug (`1500 - waited*10000`) is gone; thinking happens in a worker and never blocks drawing.
9. **Player 1 draws in black, not green.** The original used green for Player 1 and blue for Player 2. The
   real game is played with one black and one blue ballpoint, black reads better on graph paper, and it is
   the colour that survives printing and a dark sheet. Player 2 is still blue.
10. **The players' strokes are lighter than the printed pitch** — a pencil line drawn over pre-printed graph
    paper is thinner than the print, and keeping the print heavier makes it obvious which lines are not yours.
11. **The net is drawn inside the goal frame** — between the two short post lines, the way you would actually
    sketch it on paper — instead of hanging outside the pitch.
12. **Dark paper exists** (Settings → Paper, or `#dark`): the identical pitch, rules and geometry in white and
    pale-blue pencil on dark paper. Light remains the default.

Unchanged on purpose: the pitch geometry, the 8-direction single-segment kick, the shared once-only
strokes, the bounce/pass rule, the goal mouth of three dots, and the general ballpoint-on-graph-paper look.

## Testing it

No dependencies beyond Node (v24 used here). The rules and the AI live in one clearly delimited block of
`index.html` between `/* ===== ENGINE (pure logic …` and `/* ===== ENGINE END ===== */`, which these
scripts lift out of the HTML and run head-less:

```
node tools/selftest.mjs           # 50 checks: html wiring, pitch bytes, rules, undo, self-play, ladder
node tools/selftest.mjs --fast    # 45 of them — skips the ladder matches, seconds instead of minutes
node tools/uismoke.mjs            # 12 checks: boots the interface on a stub DOM, drives the key pad and the hotkeys
node tools/trace.mjs hard 800     # prints what the CPU is thinking in a hand-made position
```

`selftest.mjs` asserts the pitch matches the original exactly (segment counts, printed lines, goal mouth,
posts, hatch), that landing on a bare dot passes the turn while a lined dot is a bounce, that a dead-end
bounce loses, own-goal handling both ways, kick-off semantics, bit-for-bit undo, that every move the CPU
produces is legal, that it never passes, and that games end by the rules. The strength ladder is a
measurement, not a proof: each pairing prints the depth both sides reached, and if the machine was too busy
for the stronger side to search deeper than the weaker one, the pairing is reported as inconclusive instead of
failed. Run it on an idle machine if you want the number.

## Files

| file | role |
|---|---|
| [`index.html`](index.html) | the whole game: engine block, canvas renderer, input, settings, help |
| [`RULES.md`](RULES.md) | the rules reverse-engineered from the original, plus the open questions |
| [`football.pyw`](football.pyw) | the original pygame version, left untouched |
| [`tools/selftest.mjs`](tools/selftest.mjs) | rules, geometry, self-play and strength checks |
| [`tools/uismoke.mjs`](tools/uismoke.mjs) | interface boot and click-through test with a stub DOM |
| [`tools/trace.mjs`](tools/trace.mjs) | ad-hoc: dump the CPU's move scores in one position |
| [`preview.png`](preview.png), [`preview-demo.png`](preview-demo.png), [`preview-dark.png`](preview-dark.png) | screenshots of the page (light, CPU vs CPU, dark), so the look is reviewable without opening the game |

## Things it does not do

Two players in the same browser tab only — no accounts, no online play, no board sharing. The search treats
a goal as an instant win at every match length, which is right for "next goal wins" and an over-valuation
in a first-to-5 game (it makes the CPU fight hard for every single goal, which is rarely boring). Undo does
not undo into a different pitch size or mode. The paper is not savable or printable — it is a scratch pad.
