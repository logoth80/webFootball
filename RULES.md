# Pen-and-Paper Football — rules as implemented by `football.pyw`

Reverse-engineered from the source (pygame, single file, 550 lines). This documents what the
program **actually does**, plus the ambiguities/bugs a rewrite should decide about.
Section 10 is a compact, prompt-ready rules spec.

> **What the shipped `index.html` changes.** This document stays a description of the original. The HTML
> build plays the same game with three deliberate differences, listed under *Deliberate changes* in
> `README.md`: the printed border is the boundary of the pitch, so the goal-area hatch of §2 is not drawn and
> the strokes outside that border are blocked without being drawn (on the classic board 44 of the 404 segments
> are drawn, 48 more are off the pitch and 312 stay playable, rather than the original's 80/324); the next
> goal wins outright, with no match-length setting and no kick-off; and an own goal always scores for the
> other side, with no on/off switch.

---

## 1. What the program is

A two-player (or human-vs-CPU) hot-seat implementation of the classic pen-and-paper football
game ("piłkarzyki" / paper hockey): a ball sits on a lattice of points; players alternately draw
one straight segment to a neighbouring point; each segment may be drawn only once; landing the
ball on a point that already has a line attached gives a bonus move; the player who cannot move
loses, and the player who kicks the ball into their target goal wins.

Files used: `ball.png` (ball sprite), `ball.ico`, `kick (1..3).wav` (kick SFX, one picked at
random per kick).

## 2. Board geometry

All coordinates are on a rectangular **lattice of nodes** (intersections), one node per grid
intersection, spacing 1 unit (= 55 px in the program).

- Board = **8 cells wide × 12 cells tall** ⇒ **9 × 13 nodes**, node columns `0..8`, rows `0..12`.
  (In code: `x=4, y=6` and the field is `2*x` by `2*y` cells — probably an attempt at a "4 × 6
  doubled" field.)
- Field is portrait; goals are cut into the **top** and **bottom** edges.
- **Goal mouth**: the three nodes on the edge row centred on the middle column — columns
  `3, 4, 5` at row `0` (top goal) and at row `12` (bottom goal). The mouth is 2 cells wide,
  bounded by two drawn goal-post segments at columns 3 and 5.
- The board has **no outer boundary lines** other than the goal posts; leaving the lattice is
  simply not allowed (a move must land on a node inside `0..8 × 0..12`).

Pre-existing lines that exist at kick-off and are already "used":

| Structure | Location | Visible? |
|---|---|---|
| Left & right sidelines | vertical segments in columns 0 and 8, rows 1→11 (all except the two corner edges at rows 0–1 and 11–12) | yes |
| Half-way line | full horizontal line of segments along row 6 | yes |
| Goal-area line | horizontal segments along rows 1 and 11, **with a 2-cell gap directly in front of each goal mouth** | yes |
| Goal posts | vertical segments in columns 3 and 5, rows 0–1 and rows 11–12 | yes |
| Goal-area hatch | in every top/bottom-row cell except the two cells in front of the mouth: both diagonals (X) **and** the vertical edges of those cells | **no** — drawn then painted back to white (`invisible_paths`) |

So the goal areas are hatched exactly like the real pen-and-paper field, but the hatch is
invisible on screen while still being real for the rules (it blocks reuse and it creates bounces
near the goals). Only the goal-area boundary line and the posts are visible.

- The ball starts on the **centre node** (column 4, row 6), i.e. on the half-way line.
- Player 1 (green) targets the **top** goal; Player 2 / CPU (blue) targets the **bottom** goal.

## 3. Turns and moves

1. Player 1 always takes the first kick-off; there is no alternating kick-off and no clock/turn timer.
2. On your turn you "kick" the ball from its current node to **one of the 8 adjacent nodes**
   (orthogonal or diagonal — single unit steps only, no long passes).
3. A move is legal only if:
   - the destination node is inside the board, and
   - the **segment** between the two nodes has not been used before, in either direction, by
     anyone (segments are shared between the two players — one global line list).
   - Crossing other lines is allowed; only re-using an exact segment is forbidden.
4. The played segment is added to the shared line list and coloured in that player's colour
   (green = P1's history, blue = P2/CPU's history).
5. Field lines (sidelines, half-way line, goal-area lines/posts/hatch) are pre-used segments:
   they can never be played, but their endpoints count as "lines attached" for the bonus-move rule.

Controls (8-direction pads, mirroring the keyboard layout):

| Player | Up-left / Up / Up-right | Left / Right | Down-left / Down / Down-right |
|---|---|---|---|
| Player 1 | `Q` `W` `E` | `A` `D` | `Z` `X` `C` |
| Player 2 | `I` `O` `P` | `K` `;` | `,` `.` `/` |

## 4. Bonus move ("bounce" / knock-on)

- Immediately **before** the new segment is registered, the program asks whether the landing node
  is an endpoint of *any* already-existing segment.
- If the landing node **already has at least one line attached** (a line you drew, one your
  opponent drew, or one of the pre-existing field lines — including the invisible hatch), the
  ball "knocks on": **the same player kicks again**.
- If the landing node is completely free (no line at all), the turn ends and possession passes.
- The segment you just drew does not count towards that check, so a kick into an empty node never
  re-triggers itself.
- A turn can therefore chain arbitrarily many segments; every intermediate node must have been
  an already-lined node and the final node must be a free node (or the turn keeps going until a
  goal / a stuck situation ends it).

## 5. Goals, own goals, and losing

- After **every** kick (regardless of who kicked), the destination is checked:
  - ball on a top-goal mouth node (row 0, columns 3–5) → **Player 1 wins**;
  - ball on a bottom-goal mouth node (row 12, columns 3–5) → **Player 2 / CPU wins**.
- Because the check is not tied to the player who moved, kicking the ball into the *other* goal
  is an **own goal** and hands the win to the opponent. There is no "the ball must enter the
  goal from inside the goal area" or keeper rule.
- **Stuck = loss.** After each kick the program counts the legal directions out of the ball's
  current node; if there are 0, the player whose turn it now is loses immediately (equivalently:
  the player who made the ball stuck wins). This is also the endgame when the field fills up —
  **there is no draw rule**.
- A goal ends the game instantly: the overlay "Player 1 WON!" / "Player 2 WON!" / "CPU WON!" is
  drawn and no further kicks are accepted. There is no score table, no timer, no half-time, no
  re-kick-off. `F5` starts a new game, `ESC` quits.

## 6. CPU (toggle with `F3`)

Brute-force search over whole turns (up to 3 seconds of wall-clock search):

- It enumerates every legal multi-kick turn, following the real rules: recursion continues while
  the landing node is a bounce node, and a branch stops when the ball lands on a free node
  ("terminal"), or is scored `+∞` (never chosen) when it lands on a bounce node with no
  continuation (stuck).
- Terminal positions are scored by **squared distance to the centre of its own (bottom) goal**
  (`dx² + dy²`); the minimum is chosen, ties broken at random. It does **not** search the
  opponent's reply, does not avoid setting up opponent bounces, and does not treat "end on the
  goal node" as a special winning value (goals only materialise by accident, since goal nodes
  are the closest positions).
- The chosen path is then replayed kick by kick (each step draws the segment in blue, plays a
  random kick sound, and waits ~250 ms), then the win check runs and the turn passes to Player 1.
- Cosmetic/throttling: the CPU artificially waits at least ~1.5 s before moving.
- Quirks: if the search returns no path (nothing found in 3 s, or genuinely stuck), the CPU
  silently **skips its turn instead of losing**; the artificial minimum delay uses
  `1500 - waited*10000`, so it goes negative once the search took > 0.15 s; pressing Player-2
  keys while the CPU is thinking can still insert a Player-2 kick.

## 7. Presentation (for reference)

Pale-blue grid, white background, dark-blue field lines, green/blue move history, ball sprite at
the ball node, player-name labels near their keys, on-screen key hints, `F3` to switch Player 2 ↔ CPU,
`F5` to restart, `ESC` to quit. Kick sound on every kick.

---

## 8. Bugs / ambiguities to settle in a rewrite

1. **Invisible goal-area hatch.** Real rules in the code, invisible on screen → players can't
   see why moves are blocked or why bounces happen there. The real pen-and-paper game draws the
   hatch; a rewrite should either draw it or drop it.
2. **Field size is accidental.** `x=4, y=6` is doubled into 8×12 cells; the intended playfield
   size and goal width should be explicit parameters.
3. **Own goals are implicit** — undocumented in the UI; decide whether own goals are a rule or
   the goals should be one-way (score only in the goal you are attacking).
4. **No draw/stalemate rule** beyond "stuck loses"; no turn limit; no repetition handling.
5. **No kickoff system**: Player 1 always starts, game ends at the first goal, no score, no
   restart-the-ball-after-goal mode.
6. **AI is weak and not rule-faithful at the end** (skips instead of losing; no own-goal
   avoidance; no lookahead; goal not valued as a win; nondeterministic tie-breaks).
7. **Timing bug** in the AI delay (`*10000` instead of `*1000`).
8. Input is read on KEYUP with no per-turn input lock during the CPU animation; `F3` can be
   toggled mid-turn.
9. Hard-coded keyboard layout (QWERTY positions for the two 8-direction pads); no mouse/touch
   input, which is what a "pen and paper" clone would really want.
10. No win/loss overlay dismissal, no undo, no second game state (e.g. after a goal the whole
    board is discarded).

## 9. Rules of the real pen-and-paper game this clones (for context)

A rectangle of dots in a grid, a hatched goal area at each end (those hatch lines count as
already-drawn lines), players alternate single-unit segments between neighbouring dots, no segment
twice, landing on a dot that already has lines = kick again, a player who cannot move loses, a
goal is scored by playing the ball onto a goal dot. The program implements exactly this, except
that it hides the hatch, forbids no "second line between the same pair via a different route"
(each segment is simply unique), and treats only the three goal-mouth dots as goals.

---

## 10. Compact, prompt-ready rules spec

> Implement "paper football" on a rectangular lattice of nodes **9 × 13** (columns 0–8, rows 0–12;
> configurable W×H and goal width). Goals are the 3 centred nodes on the top edge (target of
> Player 1) and on the bottom edge (target of Player 2/CPU). At kick-off these segments already
> exist and are permanently used: the two sidelines (all but the 4 corner edges), the full
> half-way line, the goal-area line one row inside each end (with a gap in front of each mouth),
> the two goal posts, and an X-hatch of diagonals plus verticals filling the end row's cells
> except the two cells in front of each mouth — these hatch lines must be **visible**. The ball
> starts on the centre node. Players alternate (Player 1 first). A move moves the ball one unit
> to any of the 8 neighbouring nodes; the traversed segment is consumed globally and may never be
> traversed again (crossing other segments is fine). If the ball lands on a node that already had
> at least one segment attached *before* this move, the same player moves again (chain until the
> ball lands on a free node, then possession passes). Landing on a goal-mouth node of your target
> goal wins; landing in the other goal makes you lose (own goal). If the player to move has no
> legal move, they lose (no draws). First goal ends the match; show winner; keys: P1 = QWE/ASD/ZXC,
> P2 = IOP/KL;.,/ ; F3 = switch Player 2 ↔ CPU, F5 = restart, ESC = quit. The CPU must search
> whole legal turns respecting the chaining rule, must value reaching a goal node as a win, avoid
> own goals and avoid moves that leave the ball stuck for itself, and must lose (not pass) when it
> has no legal move.
