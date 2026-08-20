# Rent Divider

A small static web app for splitting rent fairly among roommates: it finds room prices such
that nobody would rather have someone else's room at that room's price.

Enter the roommates, the rooms, and the total rent, then pick one of two ways to work out
everyone's preferences:

- **Enter valuations myself** — a grid where each roommate types roughly what every room is worth
  to them (their own numbers, any scale — no need to add up to anything).
- **Ask us one at a time** — no numbers to type. Each roommate just picks their favorite room at
  the current asking prices, in turn, and the prices adjust until nobody wants to switch.

Either way, the app finds a room assignment and a price per room that is **envy-free**: nobody
would rather have someone else's room at that room's price.

## The math

This is the same problem popularized by Francis Su's Sperner's-lemma rent-division method
([Cornell INFO 2040 writeup](https://blogs.cornell.edu/info2040/2018/10/24/how-to-divide-your-rent-fairly/))
and implemented interactively in the
[New York Times rent calculator](https://www.nytimes.com/interactive/2014/science/rent-division-calculator.html).
Su's method finds market-clearing prices by iteratively querying people about a triangulated grid
of candidate prices and converging via a discrete fixed-point argument.

### Mode 1: enter valuations, solve exactly

People naturally think in terms of "what's each room worth to me" or "what's my max budget per
room" — numbers that have no reason to add up to the total rent. What actually matters for finding
a fair split is each person's *relative* valuation across rooms, not the absolute scale they
happened to type in, so the app doesn't ask anyone's numbers to sum to anything:

1. Collect each roommate's raw value for every room, whatever scale they want.
2. Scale each roommate's row proportionally so it sums to the total rent — this preserves their
   relative preferences exactly (a room worth twice as much as another stays twice as much) while
   putting everyone on the same footing, which is what makes comparing different people's numbers
   meaningful in the next step.
3. Find the room assignment that maximizes total value, via the
   [Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm) (`app.js`).
4. The Hungarian algorithm's dual variables are exactly a set of "market-clearing" room prices —
   prices at which each person's assigned room is at least as good a deal as any other room, for
   them. They're only defined up to a constant shift (shifting every price up and subtracting the
   same amount from every person's surplus doesn't change who envies whom), so the app shifts them
   so the room prices sum to exactly the total rent, then rounds to the cent using a
   largest-remainder allocation so the displayed prices always visibly add up to the total too.

The result is a room assignment and a price per room that is simultaneously:
- **Efficient** — maximizes total reported satisfaction,
- **Envy-free** — nobody would trade rooms (and prices) with anyone else, and
- **Budget-balanced** — the prices add up to exactly the total rent.

### Mode 2: ask one at a time, solve by ascending auction

This mode never asks anyone for a number — only "at these prices, which room do you want?" —
which is a much lower-friction way to elicit the same information the NYT calculator's
triangulation grid is after. It runs a classic ascending auction for assignment markets:

1. All rooms start at an equal share of the rent.
2. Roommates are asked, one at a time, which room they'd take at the current prices.
3. If a room is unclaimed, they get it. If someone else already holds it, the asker "outbids"
   them: that room's price rises by the current step size, and the person who lost it goes back
   in line to pick again at the new prices.
4. Once everyone is holding a room and nobody wants to switch, that's a checkpoint: the split is
   fair to within roughly the current step size. The user can lock it in, or halve the step and
   run another pass (starting from the current prices) for a tighter number — mirroring the "stop
   here or keep refining" choice in the NYT tool.

This is provably convergent for these unit-demand, quasilinear preferences (rent-division
valuations satisfy the gross-substitutes condition), and it converges to the same market-clearing
prices Mode 1 computes directly when the same underlying valuations are used to answer each round.

## Running it

No build step — it's plain HTML/CSS/JS.

```bash
open index.html
```

or serve it locally:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploying

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) publishes the site to
GitHub Pages on every push to `main`. Enable Pages for the repo (Settings → Pages → Source:
GitHub Actions) and it'll deploy automatically.
