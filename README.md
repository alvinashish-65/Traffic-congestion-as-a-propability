# Traffic Queue Model Comparison

Two separate studies. In each, every scenario is simulated once and every candidate model predicts that same scenario. The predictions are then compared with the simulated mean waiting time.

1. **Non-signal traffic (toll-booth style queue):** M/M/1, M/M/c, M/D/c, M/G/1.
2. **Signalised traffic (red/green approach):** Webster and Harahap et al. (2019) equation 3.7.

The dashboard is read-only. It does not run simulations.

## Requirements
- R 4.1 or newer. No extra R packages.

## Run
```
Rscript run_simulation.R
```
(or `source("run_simulation.R")` in R). Then open `dashboard/index.html` in a browser. The script writes `results/data.js`, so the page works when opened straight from disk. If `data.js` is missing the page falls back to loading the CSV files, which needs a local server: `python -m http.server 8000`, then open `http://localhost:8000/dashboard/`.

## Files written to results/
- `plain_queue_results.csv`: one row per scenario and model (non-signal)
- `signal_results.csv`: one row per scenario and model (signal)
- `model_ranking.csv`: rankings, each study ranked on its own
- `run_settings.csv`: settings used for the run
- `data.js`: the same data for the dashboard

## How to read the results
- **Applicable:** M/M/1 and M/G/1 are single-server models, so they are `NA` on 2-lane scenarios. They are not scored there.
- **Assumption matches:** M/M/c assumes exponential service and M/D/c assumes deterministic service. Each is only expected to fit when the true service matches. The ranking is shown twice: on all applicable scenarios, and only where the assumption matches.
- **Closest / best_in_scenario:** the model with the smallest absolute percent error in that scenario.
- **Inside 95% CI:** whether the prediction falls inside the confidence interval of the simulated mean.

## Modelling notes
- The simulation is the reference. Nothing measured from the simulation is fed into a formula; Harahap's Q(0) is estimated from the arrival rate and signal timing.
- Signal timing: red 153 s, green 90 s, yellow 10 s, cycle 253 s. No vehicle leaves during red or yellow, so the effective red is 163 s. Harahap's R uses 163 s to match the simulator.
- The non-signal study models one queueing system with `c` parallel servers. A four-way intersection is not an M/M/c; each signal approach is its own queue.
- Default settings are practical for a laptop. Raise `N_REP`, `HORIZON`, `N_REP_SIG` and `SIG_CYCLES` for final results and record the settings (they are saved in `run_settings.csv`).