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
- **M/G/c:** Allen-Cunneen, Erlang C x (1 + CV^2) / 2 with the scenario's true service CV^2. It is the only model that covers 2 lanes with gamma service. With 1 lane it is the same formula as M/G/1. With 2 lanes it equals M/M/c on exponential service and M/D/c on deterministic service, and it is an approximation (a few percent low).

A model whose service assumption does not match the true service (for example M/M/c when service is deterministic) is expected to be wrong; that is the point of the comparison.

## Signal study
Simulator: one lane, Poisson arrivals, FCFS. Red 153 s, green 90 s, yellow 10 s. Vehicles start discharge only during green, one every 1/1.167 s (deterministic headway). A vehicle never starts before it arrives. Waits are averaged after a warm-up of 40 cycles.

Models:
- **Webster:** the full three-term formula: uniform delay + random delay - 0.65 (C / lambda^2)^(1/3) x^(2 + 5 g/C), with x = lambda C / (s g). Without the correction term, the over-prediction grows from 0.7% at x = 0.24 to about 12% at x = 0.92. With it, the error stays within about 5%.
- **Harahap eq. 3.7:** R / (2T(1 - rho)) x [2 Q(0)/lambda + R + (1/mu)(1 + I/(1 - rho))], with rho = lambda / mu as in the paper, T = 253 s, I = 1, and R = 163 s (effective red).
- Q(0) is estimated as lambda x Webster's random-delay term (the mean overflow queue at the start of red). Because of this, the two signal models are not fully independent: they share the uniform-delay term and the overflow estimate. Harahap has no correction term, so it sits above Webster.

The script prints a check that eq. 3.7 with the paper's own inputs (lambda 0.67, R 153, Q(0) 40) gives 195.4 s.

## Limits to state in the report
- Both signal models are approximate and over-predict near saturation (degree of saturation above about 0.9) when discharge is deterministic. Harahap does so more strongly.
- On 1 lane, several models are the same formula (for example M/M/1, M/M/c, M/G/1 and M/G/c on exponential service). Ties all count as "closest", so compare models with the "same scenarios" rankings and not with win counts.
- The "all applicable" ranking mixes scenario sets: single-server models are scored on 1 lane only. The "same scenarios: 1 lane" and "same scenarios: 2 lanes" rankings score every model on identical scenarios.
- The signal simulator is a simplified single-lane model, not a validated microscopic traffic simulator.
- The paper's cycle (253 s) equals 153 + 90 + 10; the 10 s is treated here as yellow with no discharge.