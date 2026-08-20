# Rent Divider

A small static web app for splitting rent fairly among roommates: it finds room prices such
that nobody would rather have someone else's room at that room's price.

Try it: enter the roommates, the rooms, and the total rent, then have each roommate spread the
total rent across the rooms the way they honestly value living in each one (each roommate's row
has to add up to the total). The app finds the room assignment that maximizes everyone's combined
satisfaction and prices each room so the result is **envy-free**.

## The math

This is the same problem popularized by Francis Su's Sperner's-lemma rent-division method
([Cornell INFO 2040 writeup](https://blogs.cornell.edu/info2040/2018/10/24/how-to-divide-your-rent-fairly/))
and implemented interactively in the
[New York Times rent calculator](https://www.nytimes.com/interactive/2014/science/rent-division-calculator.html).
Su's method finds market-clearing prices by iteratively querying people about a triangulated grid
of candidate prices and converging via a discrete fixed-point argument.

This app solves the same problem exactly instead of iteratively, using the fact that when
valuations are known up front, envy-free prices fall directly out of linear-programming duality
for the assignment problem:

1. Collect each roommate's value for every room, with each roommate's values summing to the total
   rent.
2. Find the room assignment that maximizes total value, via the
   [Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm) (`app.js`).
3. The Hungarian algorithm's dual variables are exactly a set of "market-clearing" room prices —
   prices at which each person's assigned room is at least as good a deal as any other room, for
   them. They're only defined up to a constant shift (shifting every price up and subtracting the
   same amount from every person's surplus doesn't change who envies whom), so the app shifts them
   so the room prices sum to exactly the total rent.

The result is a room assignment and a price per room that is simultaneously:
- **Efficient** — maximizes total reported satisfaction,
- **Envy-free** — nobody would trade rooms (and prices) with anyone else, and
- **Budget-balanced** — the prices add up to exactly the total rent.

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
