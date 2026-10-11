# JP ATC Sim — Kansai / Kanto

A browser-based, realism-first air traffic control simulation of Japanese airspace:
Kansai (KIX / ITM / UKB) and Kanto (HND / NRT), built for iPad (touch) and smartphones.

**Play:** https://wata9857-ops.github.io/airplanecontrol/

## What it does

- **One continuous map with four levels.** Wide area (関西/関東 広域) → terminal (関西/関東) →
  approach (KIX / HND / NRT) → airport surface (KIX / HND / NRT 空港). Zoom is continuous and
  every aircraft keeps flying in every view (gate-to-gate for HND⇄ITM/KIX flights).
- **Real traffic.** All flights operated at KIX, HND, NRT, ITM and UKB on 2026-10-11,
  2,900+ flights, with broadcast callsigns, aircraft types and scheduled times (Flightradar24 public
  airport boards). Departures appear on stands 20 min before STD and push back on time;
  arrivals enter the area so that they land around STA.
- **Real procedures.** AIP Japan STARs, SIDs (with transitions) and ILS/RNP approach fixes and
  constraints for KIX, ITM, UKB, HND and NRT. Runway configurations follow MLIT/JCAB, e.g. KIX
  A-runway arrivals / B-runway departures since 2025-03-20, and the HND north/south-wind
  configurations and 15–19 JST new routes.
- **Flight dynamics.** Rate-limited turns (standard rate, 25° bank), acceleration and
  deceleration, IAS/TAS/Mach, climb and descent performance by type, wind (surface wind
  blended into westerlies aloft), VNAV descent planning against STAR constraints, holding
  patterns, LOC/GS capture, flare/roll-out, taxi on the OSM taxiway graph (A* routing).
- **Automatic ATC with manual override.**
  - **Automation:** AMAN-style arrival sequencing (wake-based spacing, speed control,
    holding at STAR entry fixes and IAF holds with 1,000 ft stacks), approach clearances,
    line-up-and-wait and take-off clearances, departure intervals, climb clearances and
    conflict resolution.
  - **Manual commands:** heading (incl. tap-to-vector), altitude/FL, speed, direct-to,
    hold, STAR re-route, runway change, approach clearance / cancel, go-around, pushback,
    hold position, take-off, emergency. A manual command always takes precedence; "Return
    to automation" hands the aircraft back.
- **Safety nets.** STCA with 2-minute prediction and separation-loss detection (3 NM in the
  terminal area, 5 NM en route, 1,000 ft vertical), go-arounds for runway occupancy and loss
  of spacing on final.
- **Abnormal situations.** Wind changes and runway configuration changes, runway closures,
  thunderstorm cells, emergencies (7700, return-to-base, priority).

## Data sources

| Data | Source | Status |
|---|---|---|
| STAR/SID/approach fixes, constraints, navaids | AIP Japan AD2 charts (public mirror) + VATJPN sector files | verified (a few unnamed radial/DME points marked unverified) |
| Runway thresholds | AIP Japan (HND/NRT), OpenStreetMap (others) | verified / OSM |
| Airport surface (taxiways, stands, aprons) | © OpenStreetMap contributors (ODbL) | OSM |
| Runway configurations, separation, speed rules, phraseology | MLIT, JCAB 管制業務処理規程, airport authorities | verified, unless the in-game notes say otherwise |
| Frequencies | Kansai AIP charts; others from Airband Japan | partly unverified |
| Flights (2026-10-11) | Flightradar24 public airport schedule boards | verified (operated flights) |
| Coastline | Natural Earth 10 m (public domain) | — |
| Aircraft performance | typical public values (BADA-like) | **approximation** |

Approximations are listed in the in-game menu (☰ → Data & realism notes). Examples: the wind
model, which runway within a configuration an aircraft is given, stand allocation, airway point
order (community data), and HND LDA W 22/23 approaches, which are replaced by ILS.

## Development

Static site with no build step: ES modules, Canvas 2D, and JSON data in `data/`.

```
node tools/serve.mjs 8766          # local server → http://127.0.0.1:8766/
node tools/simtest.mjs 08:00 90    # headless simulation test (throughput, go-arounds, LOS)
```

Data pipeline (research JSON → runtime data):

```
node tools/build_geo.mjs        # Natural Earth → data/geo_land.json
node tools/build_layouts.mjs    # OSM Overpass extracts → data/layout_*.json
node tools/build_schedule.mjs   # FR24 boards → research/schedules_full.json
node tools/build_data.mjs       # navdata + ops + schedule → data/nav.json, data/world.json
```

URL parameters: `?t=16:00` (start time, JST), `?v=L3-RJTT` (initial view), `?sel=ANA17`.
