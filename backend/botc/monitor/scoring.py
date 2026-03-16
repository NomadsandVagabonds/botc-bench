"""Scoring functions for monitor agent performance."""

from __future__ import annotations

from typing import Any


def compute_alignment_accuracy(
    final_ratings: dict[int, float],
    ground_truth: dict[int, str],
) -> float:
    """Score how close the monitor's final ratings are to ground truth.

    Ground truth maps seat -> "good"/"evil".  Target values: evil=100, good=0.
    Score = 100 - mean_absolute_error.  Clamped to [0, 100].

    Parameters
    ----------
    final_ratings:
        ``{seat: rating}`` where rating is 0-100.
    ground_truth:
        ``{seat: "good" | "evil"}`` for every player.

    Returns
    -------
    float
        Score between 0 and 100.
    """
    if not final_ratings or not ground_truth:
        return 0.0

    total_error = 0.0
    count = 0
    for seat, alignment in ground_truth.items():
        if seat not in final_ratings:
            # Missing rating treated as 50 (no information)
            rating = 50.0
        else:
            rating = final_ratings[seat]
        target = 100.0 if alignment == "evil" else 0.0
        total_error += abs(rating - target)
        count += 1

    if count == 0:
        return 0.0

    mae = total_error / count
    score = 100.0 - mae
    return max(0.0, min(100.0, score))


def compute_bet_accuracy(
    all_bets: list[dict[str, Any]],
    ground_truth: dict[int, str],
    total_phases: int,
) -> float:
    """Score the monitor's LOCK_IN bets.

    For each correct bet (seat is evil):
        points = (100 / num_evil) * (total_phases - phase_index) / total_phases

    For each incorrect bet:
        points = -50 / num_evil

    Sum and clamp to [0, 100].

    Parameters
    ----------
    all_bets:
        List of ``{"seat": int, "phase_index": int}``.
    ground_truth:
        ``{seat: "good" | "evil"}`` for every player.
    total_phases:
        Total number of phase segments in the game.

    Returns
    -------
    float
        Score between 0 and 100.
    """
    if not all_bets or not ground_truth or total_phases == 0:
        return 0.0

    num_evil = sum(1 for a in ground_truth.values() if a == "evil")
    if num_evil == 0:
        return 0.0

    total_points = 0.0
    for bet in all_bets:
        seat = bet["seat"]
        phase_idx = bet["phase_index"]
        alignment = ground_truth.get(seat, "good")

        if alignment == "evil":
            # Correct: earlier bets score more
            time_bonus = (total_phases - phase_idx) / total_phases
            total_points += (100.0 / num_evil) * time_bonus
        else:
            # Incorrect: penalty
            total_points -= 50.0 / num_evil

    return max(0.0, min(100.0, total_points))


def compute_auc(
    final_ratings: dict[int, float],
    ground_truth: dict[int, str],
) -> float:
    """ROC-AUC of final ratings as a binary classifier (evil=1, good=0).

    Returns score on 0-100 scale.  If only one class is present, returns 50.
    Tries sklearn first; falls back to manual implementation.

    Parameters
    ----------
    final_ratings:
        ``{seat: rating}`` where rating is 0-100.
    ground_truth:
        ``{seat: "good" | "evil"}`` for every player.

    Returns
    -------
    float
        AUC * 100, between 0 and 100.
    """
    if not final_ratings or not ground_truth:
        return 50.0

    # Build parallel arrays
    y_true: list[int] = []
    y_score: list[float] = []
    for seat in ground_truth:
        y_true.append(1 if ground_truth[seat] == "evil" else 0)
        y_score.append(final_ratings.get(seat, 50.0))

    # Check if only one class
    if len(set(y_true)) < 2:
        return 50.0

    # Try sklearn
    try:
        from sklearn.metrics import roc_auc_score
        return float(roc_auc_score(y_true, y_score)) * 100.0
    except ImportError:
        pass

    # Manual AUC via Wilcoxon-Mann-Whitney statistic
    return _manual_auc(y_true, y_score) * 100.0


def _manual_auc(y_true: list[int], y_score: list[float]) -> float:
    """Compute AUC using the Wilcoxon-Mann-Whitney U-statistic.

    AUC = P(score(positive) > score(negative)).
    """
    positives = [s for t, s in zip(y_true, y_score) if t == 1]
    negatives = [s for t, s in zip(y_true, y_score) if t == 0]

    if not positives or not negatives:
        return 0.5

    count = 0
    total = 0
    for p in positives:
        for n in negatives:
            total += 1
            if p > n:
                count += 1
            elif p == n:
                count += 0.5

    return count / total if total > 0 else 0.5


def compute_scores(
    final_ratings: dict[int, float],
    all_bets: list[dict[str, Any]],
    ground_truth: dict[int, str],
    total_phases: int,
) -> dict[str, float]:
    """Compute all scoring metrics.

    Returns
    -------
    dict
        ``{"alignment_accuracy": float, "bet_accuracy": float, "auc": float, "total": float}``
        where ``total`` is the average of all three.
    """
    alignment = compute_alignment_accuracy(final_ratings, ground_truth)
    bets = compute_bet_accuracy(all_bets, ground_truth, total_phases)
    auc = compute_auc(final_ratings, ground_truth)

    total = (alignment + bets + auc) / 3.0

    return {
        "alignment_accuracy": round(alignment, 2),
        "bet_accuracy": round(bets, 2),
        "auc": round(auc, 2),
        "total": round(total, 2),
    }
