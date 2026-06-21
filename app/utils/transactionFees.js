function getGatewayFee(t) {
    return Number(t?.gatewayFee || 0);
}

/** Fees retained by the institution (expected in bank reconciliation). */
function getInstitutionFee(t) {
    return Number(t?.institutionFee || 0);
}

/** Total fees shown to donor at checkout (Stripe + institution). Informational only. */
function getCheckoutFeeTotal(t) {
    if (t?.operationFee != null && t.operationFee !== '') {
        return Number(t.operationFee);
    }
    return getGatewayFee(t) + getInstitutionFee(t);
}

/** Amount expected to arrive in the institution bank (donation + institution fee). */
function getBankExpectedTotal(t) {
    return Number(t?.amount || 0) + getInstitutionFee(t);
}

module.exports = {
    getGatewayFee,
    getInstitutionFee,
    getCheckoutFeeTotal,
    getBankExpectedTotal
};
