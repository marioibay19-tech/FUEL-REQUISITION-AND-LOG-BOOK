# Odometer calculation method

FUELTRACK keeps two kinds of odometer values for every fueling event:

| Value | Where it comes from | Shown as |
|---|---|---|
| **Actual reading** | Read from the vehicle's odometer by a person (at fueling, or as a separate reading) | Solid navy **Actual** badge, plain numbers |
| **Estimated reading** | Calculated by the system with ratio and proportion | Dashed violet **≈ Estimated** badge, italic numbers prefixed with ≈ |

They are stored in separate database columns (`actual_odometer` and `estimated_odometer` in `odometer_logs`). The estimator never writes the actual column, a database CHECK constraint ties `reading_type` to whether an actual value exists, and reports label every value as *Actual* or *Estimated*.

The pure calculation code is in `server/src/lib/calc.ts` and is covered by `server/tests/calc.test.ts`.

## 1. Fuel issued is not fuel consumed

A single issuance does not tell you how much fuel the vehicle burned over a distance. The tank may not have been empty, or may not have been filled. FUELTRACK therefore:

- uses **only actual issuance** (fuel transactions), never the requested or approved quantity;
- builds efficiency only from **intervals between two verified actual readings**;
- attributes fuel to an interval with an explicitly chosen **consumption basis**;
- labels efficiency **Verified** only when the basis makes consumption measurable (full tank to full tank). Everything else is labelled **Estimated**.

## 2. Verified intervals

An interval runs between two consecutive odometer records whose actual reading has been **verified** by an authorized user (a different person from the encoder, by default).

```
distance (km) = verified reading at the end − verified reading at the start
```

Fuel attributed to the interval depends on the **consumption basis** setting:

| Basis | Fuel attributed to the interval | Efficiency label |
|---|---|---|
| **Full tank to full tank** (default) | All fuel dispensed *after* the start reading, up to and including the end reading (the refill replaces what was used) | **Verified** when both endpoints are full-tank fills; otherwise Estimated |
| **Issuance-based** | All fuel issued *at* the start reading and before the end reading (assumes the fuel issued is used before the next reading) | Always **Estimated** |

Fillings without a verified reading in between are included in the interval's fuel, but are never used as endpoints. Intervals with zero fuel or a non-positive distance are skipped.

```
interval efficiency (km/L) = distance ÷ fuel attributed to the interval
```

## 3. Choosing the reference interval

The **reference fuel-efficiency method** setting (System Settings → Odometer estimation) picks the reference:

| Method | Reference |
|---|---|
| **Most recent verified interval** | The latest interval before the event being estimated |
| **Rolling average** (default) | The last *N* intervals combined: Σ distance ÷ Σ fuel (weighted, not an average of ratios). *N* is configurable |
| **Approved reference** | The interval or manual figure an administrator approved for that vehicle (Vehicle → Efficiency tab). Manual references must state their source |

The estimate only uses records dated **before** the event, so later data cannot change history without a recalculation. Recalculations are audited.

## 4. Ratio and proportion

For a fueling event without an actual reading, the system computes:

```
reference liters : reference distance = liters for this interval : x

x (estimated distance, km) = (liters × reference distance) ÷ reference liters
                           = liters × reference efficiency (km/L)

estimated odometer (km) = previous VERIFIED odometer + estimated distance
```

*Liters for this interval* is the fuel attributed since the previous verified reading under the selected basis. With full-tank fills that is this refill, plus any earlier unverified fills since that reading.

### Worked example (also an automated test)

| | |
|---|---|
| Reference interval | 25,000 → 25,320 km on 40 L (full tank to full tank, both readings verified) |
| Efficiency | 320 km ÷ 40 L = **8 km/L** |
| New fueling | 25 L, no odometer reading taken |
| Proportion | 40 L : 320 km = 25 L : x |
| Estimated distance | x = (25 × 320) ÷ 40 = **200 km** |
| Estimated odometer | 25,320 + 200 = **25,520 km**, stored and shown as an **estimate** |

The record's detail panel in the Odometer Log shows all of these steps, plus the method, the consumption basis, the reference period, the reference liters and distance, and the resulting efficiency.

## 5. Rules enforced

1. Actual readings are used whenever they exist; the estimate is kept beside them for comparison.
2. Efficiency comes only from verified readings and actual issuance.
3. The method and consumption basis are configurable by administrators. Changing them requires a reason and is audited.
4. With no verified previous reading or no usable reference interval, the result is **"Insufficient Data for Estimate"**. Nothing is guessed.
5. Zero liters, or a zero reference quantity or distance, is never used (the calculation refuses it).
6. An estimate lower than the previous verified reading is flagged (`ESTIMATE_LOWER_THAN_PREVIOUS`).
7. An actual reading lower than the previous verified reading is flagged (`ACTUAL_LOWER_THAN_PREVIOUS`) and the record goes to **Flagged**.
8. A large actual-vs-estimated difference is flagged (`LARGE_VARIANCE`) when |actual − estimate| exceeds the configured percentage of the *estimated distance*. The difference is shown in km and %. The % is shown only when the estimated distance is greater than zero.
9. Estimates never replace verified readings. The vehicle's *current odometer* is always the latest **verified actual** reading.
10. A verifier can **verify** or **flag** an estimate. A verified estimate is still an estimate and is never used as a reference point.
11. Correcting an actual reading keeps the first recorded value (`original_actual_odometer`), requires a reason, sends the record back for verification, and recalculates later pending estimates.
12. Estimates are chained only from verified actual readings, never from other estimates.

## 6. Comparing actual with estimated

When an actual reading is recorded for an event that has an estimate:

```
difference (km) = actual − estimated
difference (%)  = difference ÷ estimated distance × 100
```

A large negative difference means the vehicle covered less distance than expected for the fuel issued. The system then notifies administrators with a *possible high consumption* alert, worded as a prompt to review, not a conclusion.

## 7. Limitations

- Accuracy depends on the discipline of the fueling records. Full-tank fills with readings at every fueling give **Verified** efficiency; anything else stays an estimate.
- Heavy equipment measured in operating hours (hour meters) is out of scope for this version. The method assumes kilometres.
- Consumption alerts compare a vehicle with its own history and with the median of its classification. They do not know about route, load, idling or terrain, so a person must interpret them.
