# Method notes

## Design
Each scenario is simulated once (many replications). All models predict that same scenario. Error = 100 x (prediction - simulated mean) / simulated mean. Results are means over replications with a 95% t-interval.

## Non-signal study
Simulator: Poisson arrivals, `c` servers, one shared FCFS queue. Service is exponential, deterministic, or gamma (squared CV 0.25). Utilisation per server is 0.3, 0.5, 0.7 and 0.85, for 1 and 2 lanes.

Models (mean wait in queue):
- **M/M/1:** exact for one server, exponential service. Not applicable to 2 lanes.
- **M/M/c:** Erlang C, exponential service.
- **M/D/c:** half the M/M/c wait. Exact for c = 1; an Allen-Cunneen approximation for c > 1, so errors of roughly 10 to 20% on 2 lanes are expected.
- **M/G/1:** Pollaczek-Khinchine with the scenario's true service squared CV. Not applicable to 2 lanes.

A model whose service assumption does not match the true service (for example M/M/c when service is deterministic) is expected to be wrong; that is the point of the comparison.

## Signal study
Simulator: one lane, Poisson arrivals, FCFS. Red 153 s, green 90 s, yellow 10 s. Vehicles start discharge only during green, one every 1/1.167 s (deterministic headway). A vehicle never starts before it arrives. Waits are averaged after a warm-up of 40 cycles.

Models:
- **Webster:** uniform delay + random delay, with x = lambda C / (s g). Webster's small empirical correction term is omitted.
- **Harahap eq. 3.7:** R / (2T(1 - rho)) x [2 Q(0)/lambda + R + (1/mu)(1 + I/(1 - rho))], with rho = lambda / mu as in the paper, T = 253 s, I = 1, and R = 163 s (effective red).
- Q(0) is estimated as lambda x Webster's random-delay term (the mean overflow queue at the start of red). Because of this, the two signal models are not fully independent, and both are close to each other in the results.

The script prints a check that eq. 3.7 with the paper's own inputs (lambda 0.67, R 153, Q(0) 40) gives 195.4 s.

## Limits to state in the report
- Both signal models are approximate and tend to over-predict near saturation (degree of saturation above about 0.9) when discharge is deterministic.
- The signal simulator is a simplified single-lane model, not a validated microscopic traffic simulator.
- The paper's cycle (253 s) equals 153 + 90 + 10; the 10 s is treated here as yellow with no discharge.