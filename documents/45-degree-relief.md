# 45-Degree Diagonal Relief Implementation

Handoff notes for the Python boxjoint team. This describes how the 45° diagonal
corner relief is implemented in `src/joinery/relief.ts` in the Maker-Tools app,
so the same geometry can be added to the Python `relief.py`.

---

## What it is

A relief cut at an inside corner where the arc bisects the corner at 45°,
cutting equally into both adjacent edges. Unlike the standard relief (which
places its diameter entirely along one edge), the diagonal relief's circle
center sits at 45° from the corner point, equidistant from both walls.

```
     material
  ───────┐
         │
         │         Standard relief: arc on one wall only
    ( )  │
  ───────┘
     void


     material
  ─────┐
       ╲
        ○        Diagonal relief: circle at 45°, bites both walls
       ╱
  ─────┘
     void
```

## Geometry

Given:
- `r` = relief radius (bit_diameter / 2 + clearance)
- Corner point at the junction of two perpendicular edges
- Incoming edge direction `dIn` (unit vector toward the corner)
- Outgoing edge direction `dOut` (unit vector away from the corner)

### Circle center

The center of the relief circle sits at 45° into the void from the corner,
at distance `r * sqrt(2)` from the corner (which places it exactly `r` from
each wall):

```
center = corner + r*sqrt(2) * diag_unit
```

where `diag_unit` is the unit vector at 45° into the void (see below).

### Start and end points

The arc starts on the incoming edge and ends on the outgoing edge:

```
offset = 2 * r * cos(45°) = r * sqrt(2)

start = corner - offset * dIn    (back along incoming edge)
end   = corner + offset * dOut   (forward along outgoing edge)
```

Or equivalently, for a corner at `(cx, cy)` with incoming edge horizontal
(left-to-right) and outgoing edge vertical (downward):

```
start = (cx - r*sqrt(2), cy)     on the horizontal edge
end   = (cx, cy + r*sqrt(2))     on the vertical edge
center = (cx - r*sqrt(2)/2??)    NO — see below
```

Actually, since the arc has radius `r` and the chord length is:
```
chord = distance(start, end) = sqrt((r√2)² + (r√2)²) = sqrt(2r² + 2r²) = 2r
```

A chord of length `2r` on a circle of radius `r` subtends exactly 180° —
it's a semicircle. So the arc is a semicircle, same as the standard relief.

### Direction the arc bows

The arc must bow INTO the void (away from the material). Given the two edges,
the void direction is computed from the right-hand normals of both edge
directions (both of which point into the void for an inside corner):

```python
rIn  = Vec2(dIn.y, -dIn.x)    # right-hand normal of incoming edge
rOut = Vec2(dOut.y, -dOut.x)   # right-hand normal of outgoing edge
into_void = normalize(rIn + rOut)  # 45° into the void
```

**Important:** For the SVG arc to bow correctly, you pass the negation of
`into_void` to `arc_is_ccw(start, end, into_material)` to get the sweep flag.
The right-hand normals of the edges point into the VOID (the ring is wound
material-on-left), but the arc must bow into the MATERIAL — so negate. This
is not a y-down artifact; it's the material/void distinction. The Python team
confirmed the same negation is needed in y-up.

### SVG arc command

The result is a standard SVG arc:
```
A r,r 0 0,sweep endX,endY
```

Where `sweep` = 0 or 1 depending on which semicircle you want (the one that
bows into the void).

---

## How it integrates with the contour walk

The standard relief uses a "leading/trailing" model: one corner's relief sits
on the outgoing edge, the other corner's sits on the incoming edge, and the
walk between them is a straight line.

The diagonal relief is different — it **replaces the corner entirely**:

1. The previous edge's walk stops at `start` (not at the corner point).
2. The arc goes from `start` to `end`.
3. The next edge's walk begins from `end` (not from the corner point).

In the contour-building loop:

```python
# When arriving at a diagonal corner (trailing logic of previous edge):
if next_corner.plan == "diagonal":
    start, end = diagonal_relief_points(next_corner, radius)
    walk_to(start)  # line segment to the arc's start point
    # The arc itself is emitted by the next iteration's leading logic.

# When departing from a diagonal corner (leading logic):
if cur_corner.plan == "diagonal":
    start, end = diagonal_relief_points(cur_corner, radius)
    emit_arc(start, end, radius, sweep)
    walk_from = end
```

---

## Edge budget

The diagonal relief consumes `r*sqrt(2)` ≈ `1.414r` from each adjacent edge
(vs `2r` for the standard relief on one edge). For very narrow fingers, the
diagonal is actually more forgiving — it spreads the material cost across both
edges.

Minimum finger width for diagonal: approximately `2 * r * sqrt(2)` ≈ `2.83r`
on each edge (two reliefs per edge from adjacent corners). Compare to `4r` for
standard. So diagonal allows narrower fingers.

---

## Key insight

The offset `2 * r * cos(45°)` = `r * sqrt(2)` is not the same as just `r`.
Getting this wrong (using `r * cos(45°)` = `r/sqrt(2)` instead of
`2 * r * cos(45°)` = `r * sqrt(2)`) was our main bug — the arc didn't reach
the reference circle and looked wrong. The factor of 2 comes from the fact
that the start/end points are at the extremes of the diameter projected onto
each axis, not the radius.

---

## Reference

- Implementation: `src/joinery/relief.ts` — `diagonalReliefPoints()` and the
  diagonal case in the contour walk loop.
- Test pipeline: `npm run fingers -- 150 12 7 6.35 diagonal` generates
  `qr-preview/fingers-result/corner-detail.svg` with a grid and yellow reference
  circle for visual verification.
