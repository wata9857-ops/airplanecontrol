# JP ATC Sim — Kansai / Kanto

A browser-based, realism-first air traffic control simulation of Japanese airspace:
Kansai (KIX / ITM / UKB) and Kanto (HND / NRT), built for iPad (touch) and smartphones.

**Play:** https://wata9857-ops.github.io/airplanecontrol/

## What it does

- **One continuous map with four levels.** Wide area (関西/関東 広域) → terminal (関西/関東) →
  approach (KIX / HND / NRT) → airport surface (KIX / HND / NRT 空港). Zoom is continuous and
  every aircraft keeps flying in every view (gate-to-gate for HND⇄ITM/KIX flights).
- **Real traffic.**
  - **Airport traffic:** all 2,913 flights operated at KIX, HND, NRT, ITM and UKB on 2026-10-11,
    from the Flightradar24 public airport boards. This covers domestic, international, low-cost,
    cargo and business flights from 125 airlines, with broadcast callsigns and verified radio
    telephony.
  - **Overflights:** 653 real flights that cross the area without landing at a simulated airport,
    for example FUK–CTS, Asia–North America and Anchorage cargo. Their routes are approximated as
    great circles.
  - **Timing:** departures appear on stands 20 min before STD and push back on time. Arrivals enter
    where their great-circle route crosses the airspace boundary, so they land around STA.
    Aircraft leaving the area are handed off rather than simply removed.
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
- **ATC positions.** Global mode, or work one real position. Responsibilities follow JCAB practice;
  boundaries are approximate.
  - **Ground:** Tokyo, Narita, Kansai, Osaka and Kobe Ground.
  - **Tower:** the same five airports.
  - **Approach/Departure:** Tokyo Approach (Haneda and Narita sectors) and Kansai Approach.
  - **Area control:** Tokyo and Kobe Control (lower airspace), Fukuoka Control (upper, FL335 and above).
  - **How it works:** aircraft hand off between units with check-ins. With manual clearances on,
    pilots in your jurisdiction call you with requests (pushback, taxi, take-off, landing, approach,
    climb), and you approve them from the radio panel. Everything else keeps running under automation.
- **Radio transcript.** Live controller/pilot messages per unit. Controller and pilot lines are
  colour-coded, history scrolls, and tapping a line selects the aircraft. Phraseology is English
  (ICAO) or Japanese (日本語交信), independent of the UI language.
- **UI language and themes.** Full Japanese or English interface. Dark and light map themes;
  settings are remembered.
- **Aircraft display modes.**
  - **Realistic:** silhouettes showing heading.
  - **Radar:** ARTS-style symbols and datablocks.
  - **Simple:** minimal labels and map.
  - **Beginner:** big icons, plain-language labels, a legend and alert explanations.
- **Display filters.** Airport (arriving, departing, or in its airspace), traffic type, ground or
  airborne, ATC unit, alerts only, and airline/flight/type search. Filters change only what is
  drawn: hidden aircraft keep flying and STCA still monitors them.
- **Collapsible panels.** Position selector, radio, filters, strips, aircraft panel and the ⤢
  full-map button. iPad landscape and portrait, and phones (floating side toolbar).

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
node tools/fetch_ovf_boards.mjs # boards of 31 other airports (overflight candidates)
node tools/build_ovf.mjs        # → research/overflights.json
node tools/build_data.mjs       # navdata + ops + schedule → data/nav.json, data/world.json
```

URL parameters: `?t=16:00` (start time, JST), `?v=L3-RJTT` (initial view), `?sel=ANA17`.
