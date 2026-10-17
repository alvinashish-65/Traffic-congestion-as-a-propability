# run_simulation.R
# Traffic queue model comparison, two separate studies.
#
#  Study 1  NON-SIGNAL queue (toll booth style). Candidate models:
#           M/M/1, M/M/c, M/D/c, M/G/1.
#  Study 2  SIGNALISED approach (red/green). Candidate models:
#           Webster (uniform + random delay) and Harahap et al. (2019) eq. 3.7.
#
# Design rule: every scenario is simulated ONCE. Every candidate model then
# predicts that same scenario, and the predictions are compared with the
# simulated mean wait. A model that does not apply to a scenario (for example
# M/M/1 on a 2-lane system) gets NA, not a made-up number.
#
# Run:  Rscript run_simulation.R      (no extra packages needed)
# Output: ./results/*.csv and ./results/data.js (used by the dashboard)

set.seed(20261016)
OUT_DIR <- "results"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ---------------- run settings (raise for final results) ----------------
N_REP        <- 100      # replications, non-signal study
HORIZON      <- 12000    # seconds per replication, non-signal study
WARMUP       <- 1000     # seconds discarded, non-signal study
N_REP_SIG    <- 40       # replications, signal study
SIG_CYCLES   <- 400      # cycles per replication, signal study
SIG_WARM     <- 40       # cycles discarded, signal study

# ---------------- helpers ----------------
mean_ci <- function(x, level = 0.95) {
  x <- x[is.finite(x)]; n <- length(x)
  if (n < 2) return(c(mean = if (n) mean(x) else NA_real_, lower = NA_real_, upper = NA_real_, n = n))
  m <- mean(x); hw <- qt(1 - (1 - level) / 2, n - 1) * sd(x) / sqrt(n)
  c(mean = m, lower = m - hw, upper = m + hw, n = n)
}
pct_err <- function(pred, sim) if (is.finite(pred) && is.finite(sim) && sim != 0) 100 * (pred - sim) / sim else NA_real_
in_ci   <- function(pred, lo, hi) is.finite(pred) && is.finite(lo) && pred >= lo && pred <= hi

# =====================================================================
# STUDY 1: NON-SIGNAL
# =====================================================================
# ---- analytic models (mean WAIT IN QUEUE, Wq) ----
mm1_wait <- function(lambda, mu) {
  if (lambda >= mu) return(NA_real_)
  lambda / (mu * (mu - lambda))
}
mmc_wait <- function(lambda, mu, c) {                 # Erlang C
  if (lambda >= c * mu) return(NA_real_)
  a <- lambda / mu; rho <- a / c
  s <- sum(a^(0:(c - 1)) / factorial(0:(c - 1)))
  top <- a^c / (factorial(c) * (1 - rho))
  (top / (s + top)) / (c * mu - lambda)
}
mdc_wait <- function(lambda, mu, c) 0.5 * mmc_wait(lambda, mu, c)   # exact for c = 1, Allen-Cunneen for c > 1
mg1_wait <- function(lambda, mu, cv2) {                # Pollaczek-Khinchine
  rho <- lambda / mu
  if (rho >= 1) return(NA_real_)
  (rho / (1 - rho)) * ((1 + cv2) / (2 * mu))
}

# ---- simulator: Poisson arrivals, c servers, FCFS shared queue ----
sim_plain <- function(lambda, mu, c, service, cv2, horizon, warmup) {
  arr <- cumsum(rexp(ceiling(lambda * horizon * 1.3) + 100, lambda))
  arr <- arr[arr <= horizon]; n <- length(arr)
  sv <- switch(service,
               exp   = rexp(n, mu),
               det   = rep(1 / mu, n),
               gamma = rgamma(n, shape = 1 / cv2, scale = cv2 / mu))
  w <- numeric(n)
  if (c == 1) {
    for (i in 2:n) w[i] <- max(0, w[i - 1] + sv[i - 1] - (arr[i] - arr[i - 1]))
  } else {
    free <- rep(0, c)
    for (i in seq_len(n)) {
      k <- which.min(free); st <- max(arr[i], free[k])
      w[i] <- st - arr[i]; free[k] <- st + sv[i]
    }
  }
  mean(w[arr >= warmup])
}

MU <- 0.75   # service rate per server, veh/s
service_types <- data.frame(service_type = c("exponential", "deterministic", "gamma_cv2_0.25"),
                            service = c("exp", "det", "gamma"),
                            cv2 = c(1, 0, 0.25), stringsAsFactors = FALSE)
grid <- expand.grid(st = seq_len(nrow(service_types)), lanes = c(1, 2),
                    rho = c(0.3, 0.5, 0.7, 0.85), KEEP.OUT.ATTRS = FALSE)

models_ns <- c("M/M/1", "M/M/c", "M/D/c", "M/G/1")
ns_rows <- list(); k <- 1L
for (i in seq_len(nrow(grid))) {
  st <- service_types[grid$st[i], ]; c <- grid$lanes[i]; rho <- grid$rho[i]
  lambda <- rho * c * MU                                  # total arrival rate
  sc_id <- sprintf("NS%02d", i)
  reps <- replicate(N_REP, sim_plain(lambda, MU, c, st$service, st$cv2, HORIZON, WARMUP))
  ci <- mean_ci(reps)
  preds <- c("M/M/1" = if (c == 1) mm1_wait(lambda, MU) else NA_real_,
             "M/M/c" = mmc_wait(lambda, MU, c),
             "M/D/c" = mdc_wait(lambda, MU, c),
             "M/G/1" = if (c == 1) mg1_wait(lambda, MU, st$cv2) else NA_real_)
  match_assump <- c("M/M/1" = st$service == "exp", "M/M/c" = st$service == "exp",
                    "M/D/c" = st$service == "det", "M/G/1" = TRUE)
  errs <- vapply(preds, function(p) abs(pct_err(p, ci[["mean"]])), 0)
  # every model within 1e-6 % of the smallest error counts as closest (ties are common:
  # for 1 lane + exponential service, M/M/1, M/M/c and M/G/1 are the same formula)
  best <- if (all(is.na(errs))) character(0) else names(errs)[!is.na(errs) & errs - min(errs, na.rm = TRUE) < 1e-6]
  for (m in models_ns) {
    p <- preds[[m]]
    ns_rows[[k]] <- data.frame(
      scenario = sc_id, service_type = st$service_type, service_cv2 = st$cv2,
      lanes = c, rho = rho, lambda = lambda, mu = MU, model = m,
      applicable = is.finite(p), assumption_matches = unname(match_assump[m]),
      analytic_mean_wait_s = p, simulated_mean_wait_s = ci[["mean"]],
      simulated_ci95_lower_s = ci[["lower"]], simulated_ci95_upper_s = ci[["upper"]],
      repetitions = ci[["n"]],
      absolute_error_s = abs(p - ci[["mean"]]), percent_error = pct_err(p, ci[["mean"]]),
      inside_simulated_ci95 = in_ci(p, ci[["lower"]], ci[["upper"]]),
      best_in_scenario = m %in% best, stringsAsFactors = FALSE)
    k <- k + 1L
  }
  cat(sprintf("non-signal %d/%d done\n", i, nrow(grid)))
}
plain <- do.call(rbind, ns_rows)

# =====================================================================
# STUDY 2: SIGNAL
# =====================================================================
SAT    <- 1.167   # departure (saturation) rate mu, veh/s
RED    <- 153; GREEN <- 90; YELLOW <- 10
CYCLE  <- RED + GREEN + YELLOW             # 253 s
R_EFF  <- CYCLE - GREEN                    # 163 s with no discharge (red + yellow)
I_ARR  <- 1                                # Poisson arrivals: index of dispersion = 1

webster_wait <- function(lambda) {
  x <- lambda * CYCLE / (SAT * GREEN)      # degree of saturation
  if (x >= 1) return(NA_real_)
  gr <- GREEN / CYCLE
  d1 <- CYCLE * (1 - gr)^2 / (2 * (1 - gr * x))          # uniform delay
  d2 <- I_ARR * x^2 / (2 * lambda * (1 - x))             # random / overflow delay
  d1 + d2
}
# Q(0) = mean queue left at the start of red. Estimated from lambda and the signal
# timing only (overflow queue = lambda x Webster random delay); NOT read from the simulation.
q0_estimate <- function(lambda) {
  x <- lambda * CYCLE / (SAT * GREEN)
  if (x >= 1) return(NA_real_)
  lambda * (I_ARR * x^2 / (2 * lambda * (1 - x)))
}
harahap_wait <- function(lambda, red = R_EFF, q0 = q0_estimate(lambda)) {   # eq. 3.7
  rho <- lambda / SAT                                    # rho = lambda / mu as in the paper
  if (!is.finite(q0) || rho >= 1) return(NA_real_)
  red / (2 * CYCLE * (1 - rho)) * ((2 / lambda) * q0 + red + (1 / SAT) * (1 + I_ARR / (1 - rho)))
}
cat(sprintf("Check: eq. 3.7 with the paper's inputs (lambda 0.67, R 153, Q0 40) = %.1f s (paper: 195.4)\n",
            153 / (2 * 253 * (1 - 0.67 / 1.167)) * ((2 / 0.67) * 40 + 153 + (1 / 1.167) * (1 + 1 / (1 - 0.67 / 1.167)))))

# ---- simulator: Poisson arrivals, one lane, FCFS, discharge only in green ----
# Cycle: red [0,153), green [153,243), yellow [243,253). One vehicle starts every
# 1/SAT seconds during green. A vehicle never starts before it has arrived.
sim_signal <- function(lambda) {
  H <- SIG_CYCLES * CYCLE
  arr <- cumsum(rexp(ceiling(lambda * H * 1.3) + 100, lambda)); arr <- arr[arr < H]
  n <- length(arr); st <- numeric(n); nxt <- -Inf; h <- 1 / SAT
  for (i in seq_len(n)) {
    t <- max(arr[i], nxt); ph <- t %% CYCLE
    if (ph < RED) t <- t - ph + RED else if (ph >= RED + GREEN) t <- t - ph + CYCLE + RED
    st[i] <- t; nxt <- t + h
  }
  mean((st - arr)[arr >= SIG_WARM * CYCLE])
}

sig_lambdas <- c(0.10, 0.20, 0.28, 0.34, 0.38)   # all below capacity SAT*GREEN/CYCLE = 0.415
sig_rows <- list(); k <- 1L
for (i in seq_along(sig_lambdas)) {
  lambda <- sig_lambdas[i]
  ci <- mean_ci(replicate(N_REP_SIG, sim_signal(lambda)))
  preds <- c("Webster" = webster_wait(lambda), "Harahap Eq.3.7" = harahap_wait(lambda))
  errs <- vapply(preds, function(p) abs(pct_err(p, ci[["mean"]])), 0)
  best <- names(errs)[!is.na(errs) & errs - min(errs, na.rm = TRUE) < 1e-6]
  for (m in names(preds)) {
    p <- preds[[m]]
    sig_rows[[k]] <- data.frame(
      scenario = sprintf("SIG%d", i), lambda = lambda,
      degree_of_saturation = lambda * CYCLE / (SAT * GREEN),
      departure_rate_mu = SAT, red_s = RED, green_s = GREEN, yellow_s = YELLOW,
      cycle_s = CYCLE, effective_red_s = R_EFF,
      q0_estimate = q0_estimate(lambda), dispersion_index_I = I_ARR, model = m,
      analytic_mean_wait_s = p, simulated_mean_wait_s = ci[["mean"]],
      simulated_ci95_lower_s = ci[["lower"]], simulated_ci95_upper_s = ci[["upper"]],
      repetitions = ci[["n"]],
      absolute_error_s = abs(p - ci[["mean"]]), percent_error = pct_err(p, ci[["mean"]]),
      inside_simulated_ci95 = in_ci(p, ci[["lower"]], ci[["upper"]]),
      best_in_scenario = m %in% best, stringsAsFactors = FALSE)
    k <- k + 1L
  }
  cat(sprintf("signal %d/%d done\n", i, length(sig_lambdas)))
}
signal <- do.call(rbind, sig_rows)

# =====================================================================
# RANKING (each study ranked on its own; only applicable rows are scored)
# =====================================================================
rank_models <- function(df, study, scope) {
  d <- df[df$applicable, , drop = FALSE]
  if (!nrow(d)) return(NULL)
  r <- do.call(rbind, lapply(split(d, d$model), function(x) data.frame(
    study = study, scope = scope, model = x$model[1], rows_scored = nrow(x),
    mean_absolute_error_s = mean(x$absolute_error_s),
    mean_absolute_percent_error = mean(abs(x$percent_error)),
    fraction_inside_95ci = mean(x$inside_simulated_ci95),
    wins = sum(x$best_in_scenario), stringsAsFactors = FALSE)))
  r <- r[order(r$mean_absolute_percent_error), ]
  r$rank <- seq_len(nrow(r)); r
}
signal$applicable <- is.finite(signal$analytic_mean_wait_s)
ranking <- rbind(
  rank_models(plain, "non_signal", "all applicable scenarios"),
  rank_models(plain[plain$assumption_matches, ], "non_signal", "only where the model's service assumption matches"),
  rank_models(signal, "signal", "all scenarios"))
rownames(ranking) <- NULL

settings <- data.frame(
  setting = c("seed", "nonsignal_replications", "nonsignal_horizon_s", "nonsignal_warmup_s",
              "nonsignal_mu_per_server", "signal_replications", "signal_cycles_per_rep",
              "signal_warmup_cycles", "signal_red_s", "signal_green_s", "signal_yellow_s",
              "signal_cycle_s", "signal_effective_red_s", "signal_departure_rate_mu", "signal_I"),
  value = c(20261016, N_REP, HORIZON, WARMUP, MU, N_REP_SIG, SIG_CYCLES, SIG_WARM,
            RED, GREEN, YELLOW, CYCLE, R_EFF, SAT, I_ARR), stringsAsFactors = FALSE)

# ---------------- write CSVs and data.js ----------------
w <- function(x, f) write.csv(x, file.path(OUT_DIR, f), row.names = FALSE)
w(plain, "plain_queue_results.csv"); w(signal, "signal_results.csv")
w(ranking, "model_ranking.csv");     w(settings, "run_settings.csv")

df_json <- function(df) {
  cell <- function(v) if (is.na(v)) "null" else if (is.logical(v)) tolower(as.character(v)) else
    if (is.numeric(v)) format(v, digits = 10, scientific = FALSE, trim = TRUE) else
    paste0('"', gsub('"', '\\\\"', v), '"')
  rows <- vapply(seq_len(nrow(df)), function(i)
    paste0("{", paste0('"', names(df), '":', vapply(df, function(col) cell(col[i]), ""), collapse = ","), "}"), "")
  paste0("[", paste(rows, collapse = ",\n"), "]")
}
writeLines(paste0("window.RESULTS = {\n\"plain\": ", df_json(plain), ",\n\"signal\": ", df_json(signal),
                  ",\n\"ranking\": ", df_json(ranking), ",\n\"settings\": ", df_json(settings), "\n};"),
           file.path(OUT_DIR, "data.js"))

options(width = 200)
cat("\n== Ranking ==\n"); print(ranking, digits = 3, row.names = FALSE)
cat("\nDone. Files written to ", normalizePath(OUT_DIR), "\n", sep = "")