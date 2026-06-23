/**
 * Donation & visibility rules for cases that reached their funding goal.
 *
 * - status `completed`: funding goal reached (public, badge shown)
 * - goal_reached (satisfiedBy): donations stay open unless guardian/admin closes
 * - Legacy `fully_sponsored` is normalized to `completed`
 */

const COMPLETED_STATUSES = ['completed', 'fully_sponsored'];

function isCompletedStatus(status) {
    return COMPLETED_STATUSES.includes(status);
}

function isLegacyGoalAutoComplete(foundCase) {
    return isCompletedStatus(foundCase.status) && foundCase.satisfiedBy === 'admin';
}

function hasReachedFundingGoal(foundCase) {
    const target = Number(foundCase.targetAmount) || 0;
    const raised = Number(foundCase.raisedAmount) || 0;
    return target > 0 && raised >= target;
}

function isDonationsClosed(foundCase) {
    if (!foundCase) return true;
    if (isLegacyGoalAutoComplete(foundCase)) return false;
    return foundCase.satisfiedBy === 'guardian' || foundCase.satisfiedBy === 'admin';
}

function showsCompletedBadge(foundCase) {
    if (!foundCase) return false;
    return Boolean(
        foundCase.isSatisfied ||
        hasReachedFundingGoal(foundCase) ||
        isCompletedStatus(foundCase.status)
    );
}

function fundingPercent(foundCase) {
    const target = Number(foundCase.targetAmount) || 0;
    const raised = Number(foundCase.raisedAmount) || 0;
    if (target <= 0) return 0;
    return Math.round((raised / target) * 100);
}

/** Bar width caps at 100%; amounts may still exceed target. */
function fundingBarPercent(foundCase) {
    return Math.min(fundingPercent(foundCase), 100);
}

function normalizeLegacyCompletedStatus(foundCase) {
    if (foundCase.status === 'fully_sponsored') {
        foundCase.status = 'completed';
    }
}

function applyGoalReachedState(foundCase) {
    if (!hasReachedFundingGoal(foundCase)) return;

    foundCase.isSatisfied = true;
    if (!isDonationsClosed(foundCase)) {
        foundCase.satisfiedBy = 'goal_reached';
    }
    if (['approved', 'fully_sponsored', 'completed'].includes(foundCase.status)) {
        foundCase.status = 'completed';
    }
}

/** Public listing: active and completed cases (legacy fully_sponsored included). */
const PUBLIC_CASE_STATUSES = ['approved', 'completed', 'fully_sponsored'];

module.exports = {
    COMPLETED_STATUSES,
    PUBLIC_CASE_STATUSES,
    isCompletedStatus,
    isLegacyGoalAutoComplete,
    hasReachedFundingGoal,
    isDonationsClosed,
    showsCompletedBadge,
    fundingPercent,
    fundingBarPercent,
    normalizeLegacyCompletedStatus,
    applyGoalReachedState
};
